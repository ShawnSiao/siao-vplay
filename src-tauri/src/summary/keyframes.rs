use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::chunker::PlannedChunk;
use crate::{
    media,
    store::{ProjectStore, StoreError},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SummaryFrame {
    pub id: String,
    pub ordinal: usize,
    pub timestamp_ms: i64,
    pub relative_path: String,
    pub sha256: String,
}

pub(crate) fn planned_timestamps(chunks: &[PlannedChunk]) -> Vec<(usize, i64)> {
    if chunks.is_empty() {
        return Vec::new();
    }
    let indexes = if chunks.len() <= 12 {
        (0..chunks.len()).collect::<Vec<_>>()
    } else {
        (0..12).map(|slot| slot * (chunks.len() - 1) / 11).collect()
    };
    indexes
        .into_iter()
        .map(|index| {
            let chunk = &chunks[index];
            (
                chunk.ordinal,
                chunk.start_ms + (chunk.end_ms - chunk.start_ms) / 2,
            )
        })
        .collect()
}

pub(crate) fn extract(
    store: &ProjectStore,
    task_id: &str,
    media_path: &str,
    task_directory: &Path,
    timestamps: &[(usize, i64)],
) -> Result<Vec<SummaryFrame>, StoreError> {
    if timestamps.is_empty() {
        return Ok(Vec::new());
    }
    let ffmpeg = media::ffmpeg_path().map_err(|error| StoreError::Validation(error.to_string()))?;
    let frames_directory = task_directory.join("frames");
    fs::create_dir_all(&frames_directory)?;
    let mut frames = Vec::new();
    for (index, (ordinal, timestamp)) in timestamps.iter().enumerate() {
        let name = format!("frame-{:03}.jpg", index + 1);
        let output = frames_directory.join(&name);
        let status = hidden_command(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                &format!("{:.3}", *timestamp as f64 / 1_000.0),
                "-i",
                media_path,
                "-frames:v",
                "1",
                "-vf",
                "scale=1280:-2:force_original_aspect_ratio=decrease",
                "-q:v",
                "3",
                "-y",
            ])
            .arg(&output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        if !status.success() || !output.is_file() {
            return Err(StoreError::Validation(format!(
                "无法提取总结关键帧：{timestamp} ms"
            )));
        }
        frames.push(SummaryFrame {
            id: format!("frame-{:03}", index + 1),
            ordinal: *ordinal,
            timestamp_ms: *timestamp,
            relative_path: format!("frames/{name}"),
            sha256: format!("{:x}", Sha256::digest(fs::read(&output)?)),
        });
    }
    fs::write(
        task_directory.join("frames.json"),
        serde_json::to_vec_pretty(&frames)
            .map_err(|error| StoreError::Validation(error.to_string()))?,
    )?;
    let by_ordinal = frames.iter().fold(
        BTreeMap::<usize, Vec<&SummaryFrame>>::new(),
        |mut map, frame| {
            map.entry(frame.ordinal).or_default().push(frame);
            map
        },
    );
    let connection = store.connect()?;
    for (ordinal, values) in by_ordinal {
        connection.execute(
            "UPDATE summary_chunks SET frame_manifest_json = ?3 WHERE task_id = ?1 AND ordinal = ?2",
            rusqlite::params![task_id, i64::try_from(ordinal).unwrap_or(i64::MAX), serde_json::to_string(&values).unwrap_or_else(|_| "[]".to_owned())],
        )?;
    }
    Ok(frames)
}

pub(crate) fn for_chunk(directory: &Path, ordinal: usize) -> Result<Vec<PathBuf>, StoreError> {
    let path = directory.join("frames.json");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let frames: Vec<SummaryFrame> = serde_json::from_slice(&fs::read(path)?)
        .map_err(|error| StoreError::Validation(error.to_string()))?;
    frames
        .into_iter()
        .filter(|frame| frame.ordinal == ordinal)
        .map(|frame| {
            let path = directory.join(frame.relative_path);
            if !path.is_file() {
                return Err(StoreError::Validation("总结关键帧文件缺失".to_owned()));
            }
            Ok(path)
        })
        .collect()
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_no_more_than_twelve_representative_chunks() {
        let chunks = (0..30)
            .map(|ordinal| PlannedChunk {
                ordinal,
                start_ms: ordinal as i64 * 1_000,
                end_ms: ordinal as i64 * 1_000 + 500,
                segment_ids: vec![],
                context_segment_ids: vec![],
            })
            .collect::<Vec<_>>();
        let selected = planned_timestamps(&chunks);
        assert_eq!(selected.len(), 12);
        assert_eq!(selected.first().unwrap().0, 0);
        assert_eq!(selected.last().unwrap().0, 29);
    }
}
