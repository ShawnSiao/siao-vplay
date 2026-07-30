use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    store::{ProjectStore, StoreError},
    subtitles::{self, SubtitleError, SubtitleSegment, SubtitleVersion},
};

const EXPORT_MANIFEST_FORMAT: &str = "siaovplay-subtitle-export-v1";

#[derive(Debug, Error)]
pub enum DeliveryError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Subtitle(#[from] SubtitleError),
    #[error("字幕导出失败：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("字幕导出参数无效：{0}")]
    InvalidExport(String),
    #[error("字幕导出清单生成失败：{0}")]
    Serialization(#[from] serde_json::Error),
}

impl DeliveryError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
            Self::Store(StoreError::Validation(_)) => "validation_error",
            Self::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
            Self::Store(StoreError::FileSystem(_)) | Self::FileSystem(_) => "filesystem_error",
            Self::Store(_) => "database_error",
            Self::Subtitle(SubtitleError::VersionNotFound(_)) => "subtitle_version_not_found",
            Self::Subtitle(_) => "subtitle_read_failed",
            Self::InvalidExport(_) => "subtitle_export_invalid",
            Self::Serialization(_) => "subtitle_export_serialization_failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SubtitleExportMode {
    Original,
    Translation,
    Bilingual,
}

impl SubtitleExportMode {
    fn as_file_label(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::Translation => "zh-cn",
            Self::Bilingual => "bilingual",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SubtitleExportFormat {
    Srt,
    Vtt,
}

impl SubtitleExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Srt => "srt",
            Self::Vtt => "vtt",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSubtitlesInput {
    pub project_id: String,
    pub mode: SubtitleExportMode,
    pub format: SubtitleExportFormat,
    pub source_version_id: Option<String>,
    pub translation_version_id: Option<String>,
    pub destination_directory: String,
    pub confirm_version_selection: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleExport {
    pub file_path: String,
    pub manifest_path: String,
    pub file_sha256: String,
    pub mode: SubtitleExportMode,
    pub format: SubtitleExportFormat,
    pub cue_count: usize,
    pub source_version_id: Option<String>,
    pub translation_version_id: Option<String>,
    pub media_sha256: String,
    pub exported_at_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleExportManifest<'a> {
    format: &'static str,
    project_id: &'a str,
    project_title: &'a str,
    mode: SubtitleExportMode,
    subtitle_format: SubtitleExportFormat,
    source_version: Option<SubtitleVersionReference<'a>>,
    translation_version: Option<SubtitleVersionReference<'a>>,
    media_sha256: &'a str,
    subtitle_file: &'a str,
    subtitle_file_sha256: &'a str,
    cue_count: usize,
    exported_at_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleVersionReference<'a> {
    id: &'a str,
    role: &'a str,
    language_code: &'a str,
    version_number: i64,
    status: &'a str,
    source_kind: &'a str,
    source_sha256: &'a str,
}

#[derive(Clone)]
struct ExportCue {
    start_ms: i64,
    end_ms: i64,
    text: String,
}

pub fn export_subtitles(
    store: &ProjectStore,
    input: ExportSubtitlesInput,
) -> Result<SubtitleExport, DeliveryError> {
    if !input.confirm_version_selection {
        return Err(DeliveryError::InvalidExport(
            "导出前必须确认字幕版本".to_owned(),
        ));
    }
    let project = store.get_project(&input.project_id)?;
    let versions = subtitles::list_subtitle_versions(store, &project.id)?;
    let source = optional_version(
        &versions,
        input.source_version_id.as_deref(),
        "原文字幕版本",
    )?;
    let translation = optional_version(
        &versions,
        input.translation_version_id.as_deref(),
        "简体中文字幕版本",
    )?;
    let (cues, source, translation, media_sha256) = match input.mode {
        SubtitleExportMode::Original => {
            let source = require_version(source, "原文字幕版本")?;
            validate_source_version(source)?;
            validate_current_media(&project.media_source.source_sha256, source)?;
            (
                single_track_cues(source),
                Some(source),
                None,
                source.media_sha256.as_str(),
            )
        }
        SubtitleExportMode::Translation => {
            let translation = require_version(translation, "简体中文字幕版本")?;
            validate_translation_version(translation)?;
            validate_current_media(&project.media_source.source_sha256, translation)?;
            (
                single_track_cues(translation),
                None,
                Some(translation),
                translation.media_sha256.as_str(),
            )
        }
        SubtitleExportMode::Bilingual => {
            let source = require_version(source, "原文字幕版本")?;
            let translation = require_version(translation, "简体中文字幕版本")?;
            validate_source_version(source)?;
            validate_translation_version(translation)?;
            if source.media_sha256 != translation.media_sha256 {
                return Err(DeliveryError::InvalidExport(
                    "原文与简体中文字幕不属于同一媒体版本".to_owned(),
                ));
            }
            validate_current_media(&project.media_source.source_sha256, source)?;
            (
                bilingual_cues(source, translation)?,
                Some(source),
                Some(translation),
                source.media_sha256.as_str(),
            )
        }
    };
    if cues.is_empty() {
        return Err(DeliveryError::InvalidExport(
            "所选字幕版本没有可导出的字幕段".to_owned(),
        ));
    }

    let destination = canonical_export_directory(&input.destination_directory)?;
    let exported_at_ms = now_ms()?;
    let unique_suffix = Uuid::new_v4().simple().to_string();
    let file_name = format!(
        "SiaoVPlay-{}-{}-{}-{}-{}.{}",
        safe_file_stem(&project.title),
        input.mode.as_file_label(),
        version_file_label(source, translation),
        exported_at_ms,
        &unique_suffix[..8],
        input.format.extension(),
    );
    let manifest_name = format!("{file_name}.siaovplay.json");
    let final_file_path = destination.join(&file_name);
    let final_manifest_path = destination.join(&manifest_name);
    let temporary_file_path = destination.join(format!(".{file_name}.{unique_suffix}.part"));
    let temporary_manifest_path =
        destination.join(format!(".{manifest_name}.{unique_suffix}.part"));
    let rendered = render_subtitles(input.format, &cues);

    let exported = (|| -> Result<String, DeliveryError> {
        fs::write(&temporary_file_path, rendered.as_bytes())?;
        let file_sha256 = hash_file(&temporary_file_path)?;
        let manifest = SubtitleExportManifest {
            format: EXPORT_MANIFEST_FORMAT,
            project_id: &project.id,
            project_title: &project.title,
            mode: input.mode,
            subtitle_format: input.format,
            source_version: source.map(version_reference),
            translation_version: translation.map(version_reference),
            media_sha256,
            subtitle_file: &file_name,
            subtitle_file_sha256: &file_sha256,
            cue_count: cues.len(),
            exported_at_ms,
        };
        fs::write(
            &temporary_manifest_path,
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        fs::rename(&temporary_file_path, &final_file_path)?;
        if let Err(error) = fs::rename(&temporary_manifest_path, &final_manifest_path) {
            let _ = fs::remove_file(&final_file_path);
            return Err(error.into());
        }
        Ok(file_sha256)
    })();
    let file_sha256 = match exported {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&temporary_file_path);
            let _ = fs::remove_file(&temporary_manifest_path);
            return Err(error);
        }
    };

    Ok(SubtitleExport {
        file_path: path_to_string(&final_file_path),
        manifest_path: path_to_string(&final_manifest_path),
        file_sha256,
        mode: input.mode,
        format: input.format,
        cue_count: cues.len(),
        source_version_id: source.map(|version| version.id.clone()),
        translation_version_id: translation.map(|version| version.id.clone()),
        media_sha256: media_sha256.to_owned(),
        exported_at_ms,
    })
}

fn optional_version<'a>(
    versions: &'a [SubtitleVersion],
    version_id: Option<&str>,
    label: &str,
) -> Result<Option<&'a SubtitleVersion>, DeliveryError> {
    let Some(version_id) = version_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    versions
        .iter()
        .find(|version| version.id == version_id)
        .map(Some)
        .ok_or_else(|| {
            DeliveryError::InvalidExport(format!("{label}不存在或不属于当前项目：{version_id}"))
        })
}

fn require_version<'a>(
    version: Option<&'a SubtitleVersion>,
    label: &str,
) -> Result<&'a SubtitleVersion, DeliveryError> {
    version.ok_or_else(|| DeliveryError::InvalidExport(format!("缺少{label}")))
}

fn validate_source_version(version: &SubtitleVersion) -> Result<(), DeliveryError> {
    if version.role != "original" {
        return Err(DeliveryError::InvalidExport(
            "所选原文字幕版本不属于原文字幕轨".to_owned(),
        ));
    }
    validate_version_status(version)
}

fn validate_translation_version(version: &SubtitleVersion) -> Result<(), DeliveryError> {
    if version.role != "translation" || version.language_code != "zh-cn" {
        return Err(DeliveryError::InvalidExport(
            "所选字幕版本不是简体中文字幕".to_owned(),
        ));
    }
    validate_version_status(version)
}

fn validate_version_status(version: &SubtitleVersion) -> Result<(), DeliveryError> {
    if !matches!(version.status.as_str(), "draft" | "ready") {
        return Err(DeliveryError::InvalidExport(format!(
            "字幕版本 {} 当前状态不允许导出",
            version.id
        )));
    }
    Ok(())
}

fn validate_current_media(
    current_media_sha256: &Option<String>,
    version: &SubtitleVersion,
) -> Result<(), DeliveryError> {
    if current_media_sha256
        .as_deref()
        .is_some_and(|current| !current.eq_ignore_ascii_case(&version.media_sha256))
    {
        return Err(DeliveryError::InvalidExport(
            "项目媒体已经变化，不能导出旧媒体对应的字幕".to_owned(),
        ));
    }
    Ok(())
}

fn single_track_cues(version: &SubtitleVersion) -> Vec<ExportCue> {
    version
        .segments
        .iter()
        .map(|segment| ExportCue {
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            text: normalize_cue_text(&segment.text),
        })
        .collect()
}

fn bilingual_cues(
    source: &SubtitleVersion,
    translation: &SubtitleVersion,
) -> Result<Vec<ExportCue>, DeliveryError> {
    let source_ids = source
        .segments
        .iter()
        .map(|segment| segment.id.as_str())
        .collect::<HashSet<_>>();
    let mut translated_by_source = HashMap::new();
    for segment in &translation.segments {
        let source_segment_id = segment.source_segment_id.as_deref().ok_or_else(|| {
            DeliveryError::InvalidExport(format!(
                "中文字幕第 {} 段缺少原文字幕关联",
                segment.ordinal + 1
            ))
        })?;
        if !source_ids.contains(source_segment_id) {
            return Err(DeliveryError::InvalidExport(
                "简体中文字幕与所选原文字幕版本不匹配".to_owned(),
            ));
        }
        if translated_by_source
            .insert(source_segment_id, segment)
            .is_some()
        {
            return Err(DeliveryError::InvalidExport(
                "简体中文字幕包含重复的原文字幕关联".to_owned(),
            ));
        }
    }
    if translated_by_source.len() != source.segments.len() {
        return Err(DeliveryError::InvalidExport(
            "简体中文字幕没有完整覆盖所选原文字幕版本".to_owned(),
        ));
    }

    source
        .segments
        .iter()
        .map(|source_segment| {
            let translation_segment = translated_by_source
                .get(source_segment.id.as_str())
                .ok_or_else(|| {
                    DeliveryError::InvalidExport(format!(
                        "原文字幕第 {} 段缺少简体中文翻译",
                        source_segment.ordinal + 1
                    ))
                })?;
            validate_bilingual_timing(source_segment, translation_segment)?;
            Ok(ExportCue {
                start_ms: source_segment.start_ms,
                end_ms: source_segment.end_ms,
                text: format!(
                    "{}\n{}",
                    normalize_cue_text(&source_segment.text),
                    normalize_cue_text(&translation_segment.text)
                ),
            })
        })
        .collect()
}

fn validate_bilingual_timing(
    source: &SubtitleSegment,
    translation: &SubtitleSegment,
) -> Result<(), DeliveryError> {
    if source.ordinal != translation.ordinal
        || source.start_ms != translation.start_ms
        || source.end_ms != translation.end_ms
    {
        return Err(DeliveryError::InvalidExport(format!(
            "双语字幕第 {} 段时间轴不一致",
            source.ordinal + 1
        )));
    }
    Ok(())
}

fn normalize_cue_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_subtitles(format: SubtitleExportFormat, cues: &[ExportCue]) -> String {
    let mut rendered = String::new();
    if format == SubtitleExportFormat::Vtt {
        rendered.push_str("WEBVTT\n\n");
    }
    for (index, cue) in cues.iter().enumerate() {
        if format == SubtitleExportFormat::Srt {
            rendered.push_str(&(index + 1).to_string());
            rendered.push('\n');
        }
        rendered.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_timestamp(cue.start_ms, format),
            format_timestamp(cue.end_ms, format),
            cue.text
        ));
    }
    rendered
}

fn format_timestamp(milliseconds: i64, format: SubtitleExportFormat) -> String {
    let milliseconds = milliseconds.max(0);
    let hours = milliseconds / 3_600_000;
    let minutes = (milliseconds % 3_600_000) / 60_000;
    let seconds = (milliseconds % 60_000) / 1_000;
    let millis = milliseconds % 1_000;
    let separator = match format {
        SubtitleExportFormat::Srt => ',',
        SubtitleExportFormat::Vtt => '.',
    };
    format!("{hours:02}:{minutes:02}:{seconds:02}{separator}{millis:03}")
}

fn version_file_label(
    source: Option<&SubtitleVersion>,
    translation: Option<&SubtitleVersion>,
) -> String {
    match (source, translation) {
        (Some(source), Some(translation)) => {
            format!("v{}-v{}", source.version_number, translation.version_number)
        }
        (Some(source), None) => format!("v{}", source.version_number),
        (None, Some(translation)) => format!("v{}", translation.version_number),
        (None, None) => "v0".to_owned(),
    }
}

fn version_reference(version: &SubtitleVersion) -> SubtitleVersionReference<'_> {
    SubtitleVersionReference {
        id: &version.id,
        role: &version.role,
        language_code: &version.language_code,
        version_number: version.version_number,
        status: &version.status,
        source_kind: &version.source_kind,
        source_sha256: &version.source_sha256,
    }
}

fn canonical_export_directory(value: &str) -> Result<PathBuf, DeliveryError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(DeliveryError::InvalidExport("导出位置不能为空".to_owned()));
    }
    let directory = dunce::canonicalize(value)
        .map_err(|error| DeliveryError::InvalidExport(format!("无法读取导出位置：{error}")))?;
    if !directory.is_dir() {
        return Err(DeliveryError::InvalidExport(
            "导出位置不存在或不是文件夹".to_owned(),
        ));
    }
    Ok(directory)
}

fn safe_file_stem(value: &str) -> String {
    let value = value
        .chars()
        .map(|character| {
            if character.is_control() || r#"<>:"/\|?*"#.contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    let value = value.trim().trim_matches(['.', ' ']);
    let value = value.chars().take(60).collect::<String>();
    if value.is_empty() {
        "video".to_owned()
    } else {
        value
    }
}

fn hash_file(path: &Path) -> Result<String, DeliveryError> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn now_ms() -> Result<i64, StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| StoreError::Validation(error.to_string()))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| StoreError::Validation("系统时间超出支持范围".to_owned()))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::params;

    use super::*;
    use crate::domain::CreateLocalProjectInput;

    const MEDIA_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    struct Fixture {
        _temporary: tempfile::TempDir,
        store: ProjectStore,
        project_id: String,
        source_version_id: String,
        translation_version_id: String,
        destination: PathBuf,
    }

    #[test]
    fn exports_original_translation_and_bilingual_subtitles_with_manifests() {
        let fixture = fixture();

        let original = export_subtitles(
            &fixture.store,
            input(
                &fixture,
                SubtitleExportMode::Original,
                SubtitleExportFormat::Srt,
            ),
        )
        .expect("original subtitles should export");
        assert_eq!(original.cue_count, 2);
        assert_eq!(
            original.source_version_id.as_deref(),
            Some(fixture.source_version_id.as_str())
        );
        let original_text =
            fs::read_to_string(&original.file_path).expect("SRT should be readable");
        assert!(original_text.contains("00:00:00,000 --> 00:00:01,500"));
        assert!(original_text.contains("Meet me at the station."));
        assert_manifest_matches(&original);

        let mut translation_input = input(
            &fixture,
            SubtitleExportMode::Translation,
            SubtitleExportFormat::Vtt,
        );
        translation_input.source_version_id = None;
        let translation =
            export_subtitles(&fixture.store, translation_input).expect("translation should export");
        let translation_text =
            fs::read_to_string(&translation.file_path).expect("VTT should be readable");
        assert!(translation_text.starts_with("WEBVTT\n\n"));
        assert!(translation_text.contains("00:00:00.000 --> 00:00:01.500"));
        assert!(translation_text.contains("在车站等我。"));
        assert_manifest_matches(&translation);

        let bilingual = export_subtitles(
            &fixture.store,
            input(
                &fixture,
                SubtitleExportMode::Bilingual,
                SubtitleExportFormat::Srt,
            ),
        )
        .expect("bilingual subtitles should export");
        let bilingual_text =
            fs::read_to_string(&bilingual.file_path).expect("bilingual SRT should read");
        assert!(bilingual_text.contains("Meet me at the station.\n在车站等我。"));
        assert!(bilingual_text.contains("Bring the blue umbrella.\n带上蓝色雨伞。"));
        assert_manifest_matches(&bilingual);
    }

    #[test]
    fn refuses_unconfirmed_or_mismatched_bilingual_versions() {
        let fixture = fixture();
        let mut unconfirmed = input(
            &fixture,
            SubtitleExportMode::Original,
            SubtitleExportFormat::Srt,
        );
        unconfirmed.confirm_version_selection = false;
        assert!(matches!(
            export_subtitles(&fixture.store, unconfirmed),
            Err(DeliveryError::InvalidExport(_))
        ));

        fixture
            .store
            .connect()
            .expect("connection should open")
            .execute(
                "UPDATE subtitle_segments
                 SET source_segment_id = (
                     SELECT id FROM subtitle_segments
                     WHERE version_id = ?1 AND ordinal = 0
                 )
                 WHERE version_id = ?1 AND ordinal = 1",
                params![fixture.translation_version_id],
            )
            .expect("translation relation should change");
        let error = export_subtitles(
            &fixture.store,
            input(
                &fixture,
                SubtitleExportMode::Bilingual,
                SubtitleExportFormat::Vtt,
            ),
        )
        .expect_err("mismatched versions should be rejected");
        assert!(matches!(error, DeliveryError::InvalidExport(_)));
        assert!(error.to_string().contains("不匹配"));
    }

    fn fixture() -> Fixture {
        let temporary = tempfile::tempdir().expect("temporary directory should work");
        let media_path = temporary.path().join("fixture.mp4");
        fs::write(&media_path, b"test-media").expect("media fixture should write");
        let store = ProjectStore::open(
            temporary
                .path()
                .join("data")
                .join("projects")
                .join("siaovplay.db"),
        )
        .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: path_to_string(&media_path),
                title: Some("Rain: Platform".to_owned()),
            })
            .expect("project should create");
        store
            .record_media_probe(
                &project.id,
                &project.media_source.id,
                MEDIA_SHA,
                "{}",
                10,
                None,
            )
            .expect("media hash should persist");

        let source_track_id = Uuid::new_v4().to_string();
        let source_version_id = Uuid::new_v4().to_string();
        let translation_track_id = Uuid::new_v4().to_string();
        let translation_version_id = Uuid::new_v4().to_string();
        let source_segment_ids = [Uuid::new_v4().to_string(), Uuid::new_v4().to_string()];
        let preflight = r#"{"status":"ready","segmentCount":2,"errorCount":0,"warningCount":0,"firstStartMs":0,"lastEndMs":3000,"mediaDurationMs":3000,"coverageRatio":1.0,"issues":[]}"#;
        let mut connection = store.connect().expect("connection should open");
        let transaction = connection.transaction().expect("transaction should start");
        transaction
            .execute(
                "INSERT INTO subtitle_tracks (
                    id, project_id, role, language_code, current_version_id,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'original', 'en', ?3, 1, 1)",
                params![source_track_id, project.id, source_version_id],
            )
            .expect("source track should insert");
        insert_version(
            &transaction,
            &source_version_id,
            &source_track_id,
            &project.id,
            "ready",
            "imported_file",
            "fixture-en.srt",
            "en",
            preflight,
        );
        transaction
            .execute(
                "INSERT INTO subtitle_tracks (
                    id, project_id, role, language_code, current_version_id,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'translation', 'zh-cn', ?3, 1, 1)",
                params![translation_track_id, project.id, translation_version_id],
            )
            .expect("translation track should insert");
        insert_version(
            &transaction,
            &translation_version_id,
            &translation_track_id,
            &project.id,
            "draft",
            "agent_translation",
            "Codex",
            "zh-cn",
            preflight,
        );
        insert_segment(
            &transaction,
            &source_segment_ids[0],
            &source_version_id,
            None,
            0,
            0,
            1_500,
            "Meet me at the station.",
        );
        insert_segment(
            &transaction,
            &source_segment_ids[1],
            &source_version_id,
            None,
            1,
            1_500,
            3_000,
            "Bring the blue umbrella.",
        );
        insert_segment(
            &transaction,
            &Uuid::new_v4().to_string(),
            &translation_version_id,
            Some(&source_segment_ids[0]),
            0,
            0,
            1_500,
            "在车站等我。",
        );
        insert_segment(
            &transaction,
            &Uuid::new_v4().to_string(),
            &translation_version_id,
            Some(&source_segment_ids[1]),
            1,
            1_500,
            3_000,
            "带上蓝色雨伞。",
        );
        transaction.commit().expect("fixture should commit");
        let destination = temporary.path().join("exports");
        fs::create_dir_all(&destination).expect("destination should create");
        Fixture {
            _temporary: temporary,
            store,
            project_id: project.id,
            source_version_id,
            translation_version_id,
            destination,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_version(
        transaction: &rusqlite::Transaction<'_>,
        version_id: &str,
        track_id: &str,
        project_id: &str,
        status: &str,
        source_kind: &str,
        source_label: &str,
        language_code: &str,
        preflight: &str,
    ) {
        transaction
            .execute(
                "INSERT INTO subtitle_versions (
                    id, track_id, project_id, version_number, status,
                    source_kind, source_label, source_sha256, media_sha256,
                    language_code, project_revision, preflight_json, created_at_ms
                 ) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, 1)",
                params![
                    version_id,
                    track_id,
                    project_id,
                    status,
                    source_kind,
                    source_label,
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    MEDIA_SHA,
                    language_code,
                    preflight
                ],
            )
            .expect("subtitle version should insert");
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_segment(
        transaction: &rusqlite::Transaction<'_>,
        id: &str,
        version_id: &str,
        source_segment_id: Option<&str>,
        ordinal: i64,
        start_ms: i64,
        end_ms: i64,
        text: &str,
    ) {
        transaction
            .execute(
                "INSERT INTO subtitle_segments (
                    id, version_id, lineage_id, source_segment_id, ordinal,
                    start_ms, end_ms, text, confidence, issue_kind
                 ) VALUES (?1, ?2, ?1, ?3, ?4, ?5, ?6, ?7, NULL, NULL)",
                params![
                    id,
                    version_id,
                    source_segment_id,
                    ordinal,
                    start_ms,
                    end_ms,
                    text
                ],
            )
            .expect("subtitle segment should insert");
    }

    fn input(
        fixture: &Fixture,
        mode: SubtitleExportMode,
        format: SubtitleExportFormat,
    ) -> ExportSubtitlesInput {
        ExportSubtitlesInput {
            project_id: fixture.project_id.clone(),
            mode,
            format,
            source_version_id: Some(fixture.source_version_id.clone()),
            translation_version_id: Some(fixture.translation_version_id.clone()),
            destination_directory: path_to_string(&fixture.destination),
            confirm_version_selection: true,
        }
    }

    fn assert_manifest_matches(exported: &SubtitleExport) {
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(&exported.manifest_path).expect("manifest should read"),
        )
        .expect("manifest should parse");
        assert_eq!(manifest["format"], EXPORT_MANIFEST_FORMAT);
        assert_eq!(manifest["subtitleFileSha256"], exported.file_sha256);
        assert_eq!(
            hash_file(Path::new(&exported.file_path)).expect("file should hash"),
            exported.file_sha256
        );
    }
}
