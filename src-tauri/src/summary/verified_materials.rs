use super::{
    keyframes::SummaryFrame,
    model::{AnalysisScope, SummaryTask},
    task_repository::SummaryTaskRepository,
};
use crate::{
    store::{ProjectStore, StoreError},
    subtitles::SubtitleSegment,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, path::Path, sync::Arc};

const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FRAME_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    protocol_version: String,
    project_id: String,
    scope: AnalysisScope,
    playback_cutoff_ms: Option<i64>,
    subtitle_version_id: String,
    prompt_sha256: String,
    visual_material_authorized: bool,
    segment_count: usize,
    segments: Vec<SubtitleSegment>,
    frame_timestamps_ms: Vec<i64>,
}

#[derive(Clone)]
pub(crate) struct VerifiedFrame {
    pub metadata: SummaryFrame,
    pub bytes: Arc<Vec<u8>>,
}
pub(crate) struct VerifiedMaterials {
    pub segments: Vec<SubtitleSegment>,
    pub frames: Vec<VerifiedFrame>,
}

pub(crate) fn load(
    store: &ProjectStore,
    task: &SummaryTask,
) -> Result<VerifiedMaterials, StoreError> {
    let directory = SummaryTaskRepository::new(store).materials_directory(&task.id);
    let bytes = read_bounded(&directory.join("manifest.json"), MAX_MANIFEST_BYTES)?;
    if digest(&bytes) != task.material_manifest_sha256 {
        return Err(invalid("总结材料清单已改变，请重新准备"));
    }
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| invalid("总结材料清单无效"))?;
    if manifest.protocol_version != "siaovplay-summary-v1"
        || manifest.project_id != task.project_id
        || manifest.scope != task.scope
        || manifest.playback_cutoff_ms != task.playback_cutoff_ms
        || manifest.subtitle_version_id != task.subtitle_version_id
        || manifest.prompt_sha256 != task.prompt_snapshot.sha256
        || manifest.visual_material_authorized != task.visual_material_authorized
        || manifest.segment_count != manifest.segments.len()
    {
        return Err(invalid("总结材料与任务版本不一致"));
    }
    let ids = manifest
        .segments
        .iter()
        .map(|segment| segment.id.as_str())
        .collect::<BTreeSet<_>>();
    if ids.len() != manifest.segments.len()
        || manifest.segments.iter().any(|segment| {
            segment.start_ms < 0
                || segment.end_ms < segment.start_ms
                || (task.scope == AnalysisScope::CurrentProgress
                    && task
                        .playback_cutoff_ms
                        .is_none_or(|cutoff| segment.start_ms > cutoff))
        })
        || task.chunks.iter().any(|chunk| {
            chunk
                .segment_ids
                .iter()
                .chain(&chunk.context_segment_ids)
                .any(|id| !ids.contains(id.as_str()))
        })
    {
        return Err(invalid("总结字幕超出已确认范围或缺失"));
    }
    let connection = store.connect()?;
    let mut query = connection.prepare("SELECT ordinal, frame_manifest_json, material_sha256 FROM summary_chunks WHERE task_id = ?1 ORDER BY ordinal")?;
    let rows = query.query_map([&task.id], |row| {
        Ok((
            row.get::<_, u32>(0)? as usize,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut metadata = Vec::new();
    for row in rows {
        let (ordinal, json, expected_hash) = row?;
        let chunk = task
            .chunks
            .iter()
            .find(|chunk| chunk.ordinal == ordinal)
            .ok_or_else(|| invalid("总结分块关联不一致"))?;
        let segments = chunk
            .context_segment_ids
            .iter()
            .chain(&chunk.segment_ids)
            .filter_map(|id| manifest.segments.iter().find(|segment| &segment.id == id))
            .collect::<Vec<_>>();
        if digest(&serde_json::to_vec(&segments).map_err(|_| invalid("总结分块无效"))?)
            != expected_hash
        {
            return Err(invalid("总结分块与已准备材料不一致"));
        }
        let frames: Vec<SummaryFrame> =
            serde_json::from_str(&json).map_err(|_| invalid("总结图片清单无效"))?;
        if frames.iter().any(|frame| frame.ordinal != ordinal) {
            return Err(invalid("总结图片关联不一致"));
        }
        metadata.extend(frames);
    }
    if metadata.len() > 12
        || (!task.visual_material_authorized && !metadata.is_empty())
        || metadata
            .iter()
            .map(|frame| frame.timestamp_ms)
            .collect::<Vec<_>>()
            != manifest.frame_timestamps_ms
        || metadata.iter().any(|frame| {
            frame.timestamp_ms < 0
                || (task.scope == AnalysisScope::CurrentProgress
                    && task
                        .playback_cutoff_ms
                        .is_none_or(|cutoff| frame.timestamp_ms > cutoff))
        })
    {
        return Err(invalid("总结图片超出已确认范围或提取不完整"));
    }
    let frames = metadata
        .into_iter()
        .map(|frame| verify_frame(&directory, frame))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(VerifiedMaterials {
        segments: manifest.segments,
        frames,
    })
}

pub(crate) fn verify_frame(
    directory: &Path,
    frame: SummaryFrame,
) -> Result<VerifiedFrame, StoreError> {
    let relative = Path::new(&frame.relative_path);
    let parts = relative.components().collect::<Vec<_>>();
    if parts.len() != 2
        || parts[0] != std::path::Component::Normal("frames".as_ref())
        || !matches!(parts[1], std::path::Component::Normal(_))
    {
        return Err(invalid("总结图片不在受控材料目录"));
    }
    let root = dunce::canonicalize(directory)?;
    let path = dunce::canonicalize(root.join(relative))?;
    if !path.starts_with(&root) {
        return Err(invalid("总结图片越过受控材料目录"));
    }
    let bytes = read_bounded(&path, MAX_FRAME_BYTES)?;
    if digest(&bytes) != frame.sha256 {
        return Err(invalid("总结图片在准备后发生变化"));
    }
    Ok(VerifiedFrame {
        metadata: frame,
        bytes: Arc::new(bytes),
    })
}

fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>, StoreError> {
    use std::io::Read;
    let file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take(maximum + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > maximum {
        return Err(invalid("总结材料超过安全读取上限"));
    }
    Ok(bytes)
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn invalid(message: &str) -> StoreError {
    StoreError::Validation(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::{executor, test_support::prepared_summary};

    #[test]
    fn uses_the_verified_manifest_instead_of_mutable_handoff_files() {
        let (_directory, store, task) = prepared_summary();
        let directory = Path::new(&task.materials_directory);
        fs::write(
            directory.join("subtitles.json"),
            br#"[{"text":"unconfirmed"}]"#,
        )
        .unwrap();
        fs::write(
            directory.join("frames.json"),
            br#"[{"relativePath":"../../private.jpg"}]"#,
        )
        .unwrap();
        let materials = load(&store, &task).unwrap();
        assert_eq!(materials.segments.len(), 1);
        assert_eq!(materials.segments[0].text, "past");
        assert!(materials.frames.is_empty());
    }

    #[test]
    fn refuses_changed_manifest_before_starting_a_task() {
        let (_directory, store, task) = prepared_summary();
        fs::write(
            Path::new(&task.materials_directory).join("manifest.json"),
            b"{}",
        )
        .unwrap();
        assert!(executor::start_or_resume(&store, &task.id).is_err());
        assert_eq!(
            SummaryTaskRepository::new(&store)
                .get(&task.id)
                .unwrap()
                .status,
            "prepared"
        );
    }

    #[test]
    fn refuses_chunk_content_that_no_longer_matches_its_snapshot() {
        let (_directory, store, task) = prepared_summary();
        store
            .connect()
            .unwrap()
            .execute(
                "UPDATE summary_chunks SET material_sha256 = ?1 WHERE task_id = ?2",
                rusqlite::params!["0".repeat(64), task.id],
            )
            .unwrap();
        assert!(load(&store, &task).is_err());
    }

    #[test]
    fn sends_the_verified_bytes_even_if_the_file_changes_after_loading() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("frames")).unwrap();
        let path = directory.path().join("frames/frame-001.jpg");
        fs::write(&path, b"confirmed bytes").unwrap();
        let verified = verify_frame(
            directory.path(),
            SummaryFrame {
                id: "frame-001".into(),
                ordinal: 0,
                timestamp_ms: 100,
                relative_path: "frames/frame-001.jpg".into(),
                sha256: digest(b"confirmed bytes"),
            },
        )
        .unwrap();
        fs::write(path, b"replacement bytes").unwrap();
        assert_eq!(verified.bytes.as_slice(), b"confirmed bytes");
    }
}
