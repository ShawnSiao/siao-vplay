use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    media::{self, MediaError},
    store::{ProjectStore, StoreError},
};

const MAX_SUBTITLE_BYTES: u64 = 50 * 1024 * 1024;
const LONG_GAP_MS: i64 = 30_000;
const MAX_CUE_DURATION_MS: i64 = 10_000;
const MIN_CUE_DURATION_MS: i64 = 200;
const MAX_CHARACTERS_PER_SECOND: f64 = 25.0;

#[derive(Debug, Error)]
pub enum SubtitleError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Media(#[from] MediaError),
    #[error("字幕文件读取失败：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("暂不支持该字幕格式，只支持 UTF-8 SRT 和 WebVTT")]
    UnsupportedFormat,
    #[error("字幕文件必须使用 UTF-8 编码")]
    UnsupportedEncoding,
    #[error("字幕解析失败：{0}")]
    Parse(String),
    #[error("语言代码无效：{0}")]
    InvalidLanguage(String),
    #[error("字幕预检未通过，包含 {0} 项错误")]
    PreflightBlocked(usize),
    #[error("字幕来源在确认后发生变化，请重新预检")]
    SubtitleSourceChanged,
    #[error("项目在字幕预检后发生变化，请重新预检")]
    ProjectChanged,
    #[error("媒体在字幕预检后发生变化，请重新预检")]
    MediaChanged,
    #[error("字幕预检结果无法保存：{0}")]
    Serialization(#[from] serde_json::Error),
}

impl From<rusqlite::Error> for SubtitleError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(StoreError::Database(error))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SubtitleFileFormat {
    Srt,
    Vtt,
}

impl SubtitleFileFormat {
    fn from_path(path: &Path) -> Result<Self, SubtitleError> {
        match path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("srt") => Ok(Self::Srt),
            Some("vtt") => Ok(Self::Vtt),
            _ => Err(SubtitleError::UnsupportedFormat),
        }
    }

    fn as_source_label(self) -> &'static str {
        match self {
            Self::Srt => "SRT",
            Self::Vtt => "WebVTT",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCue {
    pub ordinal: usize,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: Option<f64>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SubtitleIssueSeverity {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SubtitleIssueCode {
    EmptyText,
    InvalidTiming,
    OutOfOrder,
    OutOfBounds,
    Overlap,
    LongGap,
    DurationTooShort,
    DurationTooLong,
    ReadingSpeedHigh,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitlePreflightIssue {
    pub code: SubtitleIssueCode,
    pub severity: SubtitleIssueSeverity,
    pub ordinal: Option<usize>,
    pub related_ordinal: Option<usize>,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SubtitlePreflightStatus {
    Ready,
    Warning,
    Blocked,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitlePreflightReport {
    pub status: SubtitlePreflightStatus,
    pub segment_count: usize,
    pub error_count: usize,
    pub warning_count: usize,
    pub first_start_ms: Option<i64>,
    pub last_end_ms: Option<i64>,
    pub media_duration_ms: Option<i64>,
    pub coverage_ratio: Option<f64>,
    pub issues: Vec<SubtitlePreflightIssue>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleImportPreview {
    pub format: SubtitleFileFormat,
    pub source_label: String,
    pub source_sha256: String,
    pub language_code: String,
    pub expected_project_revision: i64,
    pub expected_media_sha256: String,
    pub cues: Vec<SubtitleCue>,
    pub preflight: SubtitlePreflightReport,
    pub can_import: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectSubtitleFileInput {
    pub project_id: String,
    pub subtitle_path: String,
    pub language_code: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSubtitleFileInput {
    pub project_id: String,
    pub subtitle_path: String,
    pub language_code: String,
    pub expected_source_sha256: String,
    pub expected_media_sha256: String,
    pub expected_project_revision: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedSubtitlePreview {
    pub stream_index: i64,
    pub codec_name: String,
    pub embedded_language: Option<String>,
    #[serde(flatten)]
    pub subtitle: SubtitleImportPreview,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectEmbeddedSubtitleInput {
    pub project_id: String,
    pub stream_index: i64,
    pub language_code: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEmbeddedSubtitleInput {
    pub project_id: String,
    pub stream_index: i64,
    pub language_code: String,
    pub expected_source_sha256: String,
    pub expected_media_sha256: String,
    pub expected_project_revision: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleSegment {
    pub id: String,
    pub ordinal: usize,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleVersion {
    pub id: String,
    pub track_id: String,
    pub project_id: String,
    pub version_number: i64,
    pub status: String,
    pub source_kind: String,
    pub source_label: String,
    pub source_sha256: String,
    pub media_sha256: String,
    pub language_code: String,
    pub project_revision: i64,
    pub preflight: SubtitlePreflightReport,
    pub created_at_ms: i64,
    pub is_current: bool,
    pub segments: Vec<SubtitleSegment>,
}

#[derive(Clone, Copy)]
enum SubtitleSourceKind {
    ImportedFile,
    Embedded,
}

impl SubtitleSourceKind {
    fn as_database_value(self) -> &'static str {
        match self {
            Self::ImportedFile => "imported_file",
            Self::Embedded => "embedded",
        }
    }
}

pub fn inspect_subtitle_file(
    store: &ProjectStore,
    input: &InspectSubtitleFileInput,
) -> Result<SubtitleImportPreview, SubtitleError> {
    let language_code = normalize_language_code(&input.language_code)?;
    let subtitle_path = canonical_subtitle_path(&input.subtitle_path)?;
    let project_before = store.get_project(&input.project_id)?;
    let media_inspection = media::inspect_project_media(store, &input.project_id)?;
    let project = store.get_project(&input.project_id)?;
    if project.revision != project_before.revision {
        return Err(SubtitleError::ProjectChanged);
    }
    let parsed = read_and_parse(&subtitle_path)?;
    let preflight = inspect_cues(&parsed.cues, media_inspection.probe.duration_ms);
    let source_label = subtitle_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_else(|| parsed.format.as_source_label())
        .to_owned();

    Ok(SubtitleImportPreview {
        format: parsed.format,
        source_label,
        source_sha256: parsed.source_sha256,
        language_code,
        expected_project_revision: project.revision,
        expected_media_sha256: media_inspection.source_sha256,
        can_import: preflight.error_count == 0,
        cues: parsed.cues,
        preflight,
    })
}

pub fn import_subtitle_file(
    store: &ProjectStore,
    input: ImportSubtitleFileInput,
) -> Result<SubtitleVersion, SubtitleError> {
    let preview = inspect_subtitle_file(
        store,
        &InspectSubtitleFileInput {
            project_id: input.project_id.clone(),
            subtitle_path: input.subtitle_path,
            language_code: input.language_code,
        },
    )?;
    if !preview
        .source_sha256
        .eq_ignore_ascii_case(&input.expected_source_sha256)
    {
        return Err(SubtitleError::SubtitleSourceChanged);
    }
    if preview.expected_project_revision != input.expected_project_revision {
        return Err(SubtitleError::ProjectChanged);
    }
    if !preview
        .expected_media_sha256
        .eq_ignore_ascii_case(&input.expected_media_sha256)
    {
        return Err(SubtitleError::MediaChanged);
    }
    if !preview.can_import {
        return Err(SubtitleError::PreflightBlocked(
            preview.preflight.error_count,
        ));
    }
    persist_import(
        store,
        &input.project_id,
        preview,
        SubtitleSourceKind::ImportedFile,
    )
}

pub fn inspect_embedded_subtitle(
    store: &ProjectStore,
    input: &InspectEmbeddedSubtitleInput,
) -> Result<EmbeddedSubtitlePreview, SubtitleError> {
    let language_code = normalize_language_code(&input.language_code)?;
    let project_before = store.get_project(&input.project_id)?;
    let cache_root = store
        .data_directory()
        .join("subtitle-cache")
        .join(&input.project_id);
    fs::create_dir_all(&cache_root)?;
    let temporary_path = cache_root.join(format!(
        "embedded-{}-{}.preview.vtt",
        input.stream_index,
        Uuid::new_v4()
    ));
    let extraction = media::extract_embedded_subtitle_to_vtt(
        store,
        &input.project_id,
        input.stream_index,
        None,
        &temporary_path,
    );
    let (inspection, stream) = match extraction {
        Ok(value) => value,
        Err(error) => {
            let _ = remove_controlled_cache_file(&temporary_path, &cache_root);
            return Err(error.into());
        }
    };
    let parsed = read_and_parse(&temporary_path);
    let cleanup = remove_controlled_cache_file(&temporary_path, &cache_root);
    let parsed = parsed?;
    cleanup?;
    let project = store.get_project(&input.project_id)?;
    if project.revision != project_before.revision {
        return Err(SubtitleError::ProjectChanged);
    }
    let preflight = inspect_cues(&parsed.cues, inspection.probe.duration_ms);
    let source_label = embedded_source_label(
        input.stream_index,
        stream.language.as_deref(),
        &stream.codec_name,
    );
    Ok(EmbeddedSubtitlePreview {
        stream_index: input.stream_index,
        codec_name: stream.codec_name,
        embedded_language: stream.language,
        subtitle: SubtitleImportPreview {
            format: parsed.format,
            source_label,
            source_sha256: parsed.source_sha256,
            language_code,
            expected_project_revision: project.revision,
            expected_media_sha256: inspection.source_sha256,
            can_import: preflight.error_count == 0,
            cues: parsed.cues,
            preflight,
        },
    })
}

pub fn import_embedded_subtitle(
    store: &ProjectStore,
    input: ImportEmbeddedSubtitleInput,
) -> Result<SubtitleVersion, SubtitleError> {
    let preview = inspect_embedded_subtitle(
        store,
        &InspectEmbeddedSubtitleInput {
            project_id: input.project_id.clone(),
            stream_index: input.stream_index,
            language_code: input.language_code,
        },
    )?;
    if !preview
        .subtitle
        .source_sha256
        .eq_ignore_ascii_case(&input.expected_source_sha256)
    {
        return Err(SubtitleError::SubtitleSourceChanged);
    }
    if preview.subtitle.expected_project_revision != input.expected_project_revision {
        return Err(SubtitleError::ProjectChanged);
    }
    if !preview
        .subtitle
        .expected_media_sha256
        .eq_ignore_ascii_case(&input.expected_media_sha256)
    {
        return Err(SubtitleError::MediaChanged);
    }
    if !preview.subtitle.can_import {
        return Err(SubtitleError::PreflightBlocked(
            preview.subtitle.preflight.error_count,
        ));
    }
    persist_import(
        store,
        &input.project_id,
        preview.subtitle,
        SubtitleSourceKind::Embedded,
    )
}

pub fn list_subtitle_versions(
    store: &ProjectStore,
    project_id: &str,
) -> Result<Vec<SubtitleVersion>, SubtitleError> {
    let project = store.get_project(project_id)?;
    let connection = store.connect()?;
    let mut statement = connection.prepare(
        "SELECT
            v.id, v.track_id, v.project_id, v.version_number, v.status,
            v.source_kind, v.source_label, v.source_sha256, v.media_sha256,
            v.language_code, v.project_revision, v.preflight_json,
            v.created_at_ms,
            CASE WHEN t.current_version_id = v.id THEN 1 ELSE 0 END
         FROM subtitle_versions v
         JOIN subtitle_tracks t ON t.id = v.track_id
         WHERE v.project_id = ?1
         ORDER BY v.created_at_ms DESC, v.version_number DESC, v.id DESC",
    )?;
    let rows = statement
        .query_map(params![project.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, bool>(13)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    rows.into_iter()
        .map(|row| {
            let preflight = serde_json::from_str(&row.11)?;
            let segments = load_segments(&connection, &row.0)?;
            Ok(SubtitleVersion {
                id: row.0,
                track_id: row.1,
                project_id: row.2,
                version_number: row.3,
                status: row.4,
                source_kind: row.5,
                source_label: row.6,
                source_sha256: row.7,
                media_sha256: row.8,
                language_code: row.9,
                project_revision: row.10,
                preflight,
                created_at_ms: row.12,
                is_current: row.13,
                segments,
            })
        })
        .collect()
}

fn persist_import(
    store: &ProjectStore,
    project_id: &str,
    preview: SubtitleImportPreview,
    source_kind: SubtitleSourceKind,
) -> Result<SubtitleVersion, SubtitleError> {
    let timestamp = now_ms()?;
    let track_id = Uuid::new_v4().to_string();
    let version_id = Uuid::new_v4().to_string();
    let new_project_revision = preview.expected_project_revision + 1;
    let preflight_json = serde_json::to_string(&preview.preflight)?;
    let mut connection = store.connect()?;
    let transaction = connection.transaction()?;

    let current_state = transaction
        .query_row(
            "SELECT p.revision, m.source_sha256
             FROM projects p
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             WHERE p.id = ?1",
            params![project_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?
        .ok_or_else(|| StoreError::ProjectNotFound(project_id.to_owned()))?;
    if current_state.0 != preview.expected_project_revision {
        return Err(SubtitleError::ProjectChanged);
    }
    if current_state
        .1
        .as_deref()
        .is_none_or(|value| !value.eq_ignore_ascii_case(&preview.expected_media_sha256))
    {
        return Err(SubtitleError::MediaChanged);
    }

    let existing_track_id = transaction
        .query_row(
            "SELECT id FROM subtitle_tracks
             WHERE project_id = ?1 AND role = 'original'",
            params![project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let track_id = if let Some(existing_track_id) = existing_track_id {
        transaction.execute(
            "UPDATE subtitle_tracks
             SET language_code = ?2, updated_at_ms = ?3
             WHERE id = ?1",
            params![existing_track_id, preview.language_code, timestamp],
        )?;
        existing_track_id
    } else {
        transaction.execute(
            "INSERT INTO subtitle_tracks (
                id, project_id, role, language_code, current_version_id,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'original', ?3, NULL, ?4, ?4)",
            params![track_id, project_id, preview.language_code, timestamp],
        )?;
        track_id
    };
    let version_number = transaction.query_row(
        "SELECT COALESCE(MAX(version_number), 0) + 1
         FROM subtitle_versions WHERE track_id = ?1",
        params![track_id],
        |row| row.get::<_, i64>(0),
    )?;
    transaction.execute(
        "INSERT INTO subtitle_versions (
            id, track_id, project_id, version_number, status, source_kind,
            source_label, source_sha256, media_sha256, language_code,
            project_revision, preflight_json, created_at_ms
         ) VALUES (
            ?1, ?2, ?3, ?4, 'ready', ?5,
            ?6, ?7, ?8, ?9, ?10, ?11, ?12
         )",
        params![
            version_id,
            track_id,
            project_id,
            version_number,
            source_kind.as_database_value(),
            preview.source_label,
            preview.source_sha256,
            preview.expected_media_sha256,
            preview.language_code,
            new_project_revision,
            preflight_json,
            timestamp
        ],
    )?;
    for cue in &preview.cues {
        transaction.execute(
            "INSERT INTO subtitle_segments (
                id, version_id, ordinal, start_ms, end_ms, text, confidence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4().to_string(),
                version_id,
                i64::try_from(cue.ordinal).map_err(|_| {
                    StoreError::Validation("字幕段序号超出支持范围".to_owned())
                })?,
                cue.start_ms,
                cue.end_ms,
                cue.text,
                cue.confidence
            ],
        )?;
    }
    transaction.execute(
        "UPDATE subtitle_tracks
         SET current_version_id = ?2, updated_at_ms = ?3
         WHERE id = ?1",
        params![track_id, version_id, timestamp],
    )?;
    let project_updated = transaction.execute(
        "UPDATE projects
         SET revision = ?2, updated_at_ms = ?3
         WHERE id = ?1 AND revision = ?4",
        params![
            project_id,
            new_project_revision,
            timestamp,
            preview.expected_project_revision
        ],
    )?;
    if project_updated != 1 {
        return Err(SubtitleError::ProjectChanged);
    }
    transaction.commit()?;

    list_subtitle_versions(store, project_id)?
        .into_iter()
        .find(|version| version.id == version_id)
        .ok_or_else(|| StoreError::Validation("字幕版本已写入，但无法重新读取".to_owned()).into())
}

fn load_segments(
    connection: &rusqlite::Connection,
    version_id: &str,
) -> Result<Vec<SubtitleSegment>, SubtitleError> {
    let mut statement = connection.prepare(
        "SELECT id, ordinal, start_ms, end_ms, text, confidence
         FROM subtitle_segments
         WHERE version_id = ?1
         ORDER BY ordinal ASC",
    )?;
    statement
        .query_map(params![version_id], |row| {
            let ordinal = row.get::<_, i64>(1)?;
            let ordinal = usize::try_from(ordinal).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Integer,
                    Box::new(error),
                )
            })?;
            Ok(SubtitleSegment {
                id: row.get(0)?,
                ordinal,
                start_ms: row.get(2)?,
                end_ms: row.get(3)?,
                text: row.get(4)?,
                confidence: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
        .map_err(Into::into)
}

struct ParsedSubtitle {
    format: SubtitleFileFormat,
    source_sha256: String,
    cues: Vec<SubtitleCue>,
}

fn read_and_parse(path: &Path) -> Result<ParsedSubtitle, SubtitleError> {
    let format = SubtitleFileFormat::from_path(path)?;
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_SUBTITLE_BYTES {
        return Err(SubtitleError::Parse(format!(
            "字幕文件超过 {} MiB 上限",
            MAX_SUBTITLE_BYTES / 1024 / 1024
        )));
    }
    let bytes = fs::read(path)?;
    let source_sha256 = format!("{:x}", Sha256::digest(&bytes));
    let text = String::from_utf8(bytes).map_err(|_| SubtitleError::UnsupportedEncoding)?;
    let text = text
        .strip_prefix('\u{feff}')
        .unwrap_or(&text)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let cues = match format {
        SubtitleFileFormat::Srt => parse_srt(&text)?,
        SubtitleFileFormat::Vtt => parse_vtt(&text)?,
    };
    if cues.is_empty() {
        return Err(SubtitleError::Parse(
            "字幕文件没有可识别的字幕段".to_owned(),
        ));
    }
    Ok(ParsedSubtitle {
        format,
        source_sha256,
        cues,
    })
}

fn parse_srt(text: &str) -> Result<Vec<SubtitleCue>, SubtitleError> {
    let mut cues = Vec::new();
    for (block_index, block) in text_blocks(text).into_iter().enumerate() {
        let timing_index = block
            .iter()
            .position(|line| line.contains("-->"))
            .ok_or_else(|| {
                SubtitleError::Parse(format!("第 {} 个 SRT 字幕块缺少时间码", block_index + 1))
            })?;
        let (start_ms, end_ms) = parse_timing_line(block[timing_index])?;
        let cue_text = block[timing_index + 1..].join("\n");
        cues.push(SubtitleCue {
            ordinal: cues.len(),
            start_ms,
            end_ms,
            text: cue_text,
            confidence: None,
        });
    }
    Ok(cues)
}

fn parse_vtt(text: &str) -> Result<Vec<SubtitleCue>, SubtitleError> {
    let first_line = text.lines().next().unwrap_or_default().trim();
    if !first_line.starts_with("WEBVTT") {
        return Err(SubtitleError::Parse(
            "WebVTT 文件缺少 WEBVTT 文件头".to_owned(),
        ));
    }
    let body = text
        .split_once('\n')
        .map(|(_, body)| body)
        .unwrap_or_default();
    let mut cues = Vec::new();
    for block in text_blocks(body) {
        let first = block.first().map(|line| line.trim()).unwrap_or_default();
        if first.starts_with("NOTE") || first == "STYLE" || first == "REGION" {
            continue;
        }
        let Some(timing_index) = block.iter().position(|line| line.contains("-->")) else {
            continue;
        };
        let (start_ms, end_ms) = parse_timing_line(block[timing_index])?;
        let cue_text = block[timing_index + 1..].join("\n");
        cues.push(SubtitleCue {
            ordinal: cues.len(),
            start_ms,
            end_ms,
            text: cue_text,
            confidence: None,
        });
    }
    Ok(cues)
}

fn text_blocks(text: &str) -> Vec<Vec<&str>> {
    let mut blocks = Vec::new();
    let mut current = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
        } else {
            current.push(line);
        }
    }
    if !current.is_empty() {
        blocks.push(current);
    }
    blocks
}

fn parse_timing_line(value: &str) -> Result<(i64, i64), SubtitleError> {
    let (start, raw_end) = value
        .split_once("-->")
        .ok_or_else(|| SubtitleError::Parse("时间码缺少 --> 分隔符".to_owned()))?;
    let end = raw_end
        .split_whitespace()
        .next()
        .ok_or_else(|| SubtitleError::Parse("时间码缺少结束时间".to_owned()))?;
    Ok((parse_timestamp(start)?, parse_timestamp(end)?))
}

fn parse_timestamp(value: &str) -> Result<i64, SubtitleError> {
    let value = value.trim().replace(',', ".");
    let parts = value.split(':').collect::<Vec<_>>();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (0_i64, parse_component(minutes)?, *seconds),
        [hours, minutes, seconds] => (parse_component(hours)?, parse_component(minutes)?, *seconds),
        _ => {
            return Err(SubtitleError::Parse(format!("时间码格式无效：{value}")));
        }
    };
    if minutes >= 60 {
        return Err(SubtitleError::Parse(format!("时间码分钟范围无效：{value}")));
    }
    let (seconds, milliseconds) = match seconds.split_once('.') {
        Some((seconds, fraction)) => {
            if fraction.is_empty()
                || fraction.len() > 3
                || !fraction.bytes().all(|byte| byte.is_ascii_digit())
            {
                return Err(SubtitleError::Parse(format!("时间码毫秒格式无效：{value}")));
            }
            let mut milliseconds = fraction.to_owned();
            while milliseconds.len() < 3 {
                milliseconds.push('0');
            }
            (parse_component(seconds)?, parse_component(&milliseconds)?)
        }
        None => (parse_component(seconds)?, 0),
    };
    if seconds >= 60 {
        return Err(SubtitleError::Parse(format!("时间码秒数范围无效：{value}")));
    }
    hours
        .checked_mul(3_600_000)
        .and_then(|total| {
            minutes
                .checked_mul(60_000)
                .and_then(|v| total.checked_add(v))
        })
        .and_then(|total| {
            seconds
                .checked_mul(1_000)
                .and_then(|v| total.checked_add(v))
        })
        .and_then(|total| total.checked_add(milliseconds))
        .ok_or_else(|| SubtitleError::Parse(format!("时间码超出支持范围：{value}")))
}

fn parse_component(value: &str) -> Result<i64, SubtitleError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(SubtitleError::Parse(format!("时间码数字格式无效：{value}")));
    }
    value
        .parse::<i64>()
        .map_err(|_| SubtitleError::Parse(format!("时间码数字超出支持范围：{value}")))
}

fn inspect_cues(cues: &[SubtitleCue], media_duration_ms: Option<i64>) -> SubtitlePreflightReport {
    let mut issues = Vec::new();
    for cue in cues {
        let valid_timing = cue.start_ms >= 0 && cue.end_ms > cue.start_ms;
        if !valid_timing {
            issues.push(preflight_issue(
                SubtitleIssueCode::InvalidTiming,
                SubtitleIssueSeverity::Error,
                Some(cue.ordinal),
                None,
                "字幕开始和结束时间无效",
            ));
        }
        if cue.text.trim().is_empty() {
            issues.push(preflight_issue(
                SubtitleIssueCode::EmptyText,
                SubtitleIssueSeverity::Error,
                Some(cue.ordinal),
                None,
                "字幕文本为空",
            ));
        }
        if let Some(media_duration_ms) = media_duration_ms
            && cue.end_ms > media_duration_ms + 500
        {
            issues.push(preflight_issue(
                SubtitleIssueCode::OutOfBounds,
                SubtitleIssueSeverity::Error,
                Some(cue.ordinal),
                None,
                "字幕结束时间超过媒体时长",
            ));
        }
        if !valid_timing {
            continue;
        }
        let duration_ms = cue.end_ms - cue.start_ms;
        if duration_ms < MIN_CUE_DURATION_MS {
            issues.push(preflight_issue(
                SubtitleIssueCode::DurationTooShort,
                SubtitleIssueSeverity::Warning,
                Some(cue.ordinal),
                None,
                "单条字幕持续时间过短",
            ));
        }
        if duration_ms > MAX_CUE_DURATION_MS {
            issues.push(preflight_issue(
                SubtitleIssueCode::DurationTooLong,
                SubtitleIssueSeverity::Warning,
                Some(cue.ordinal),
                None,
                "单条字幕持续时间过长",
            ));
        }
        let visible_characters = cue
            .text
            .chars()
            .filter(|character| !character.is_whitespace())
            .count();
        let characters_per_second = visible_characters as f64 / (duration_ms as f64 / 1_000.0);
        if characters_per_second > MAX_CHARACTERS_PER_SECOND {
            issues.push(preflight_issue(
                SubtitleIssueCode::ReadingSpeedHigh,
                SubtitleIssueSeverity::Warning,
                Some(cue.ordinal),
                None,
                "字幕阅读速度过快",
            ));
        }
    }

    for pair in cues.windows(2) {
        let previous = &pair[0];
        let current = &pair[1];
        if current.start_ms < previous.start_ms {
            issues.push(preflight_issue(
                SubtitleIssueCode::OutOfOrder,
                SubtitleIssueSeverity::Error,
                Some(current.ordinal),
                Some(previous.ordinal),
                "字幕时间顺序倒置",
            ));
            continue;
        }
        let gap_ms = current.start_ms - previous.end_ms;
        if gap_ms < 0 {
            issues.push(preflight_issue(
                SubtitleIssueCode::Overlap,
                SubtitleIssueSeverity::Warning,
                Some(current.ordinal),
                Some(previous.ordinal),
                "与上一条字幕时间重叠",
            ));
        } else if gap_ms > LONG_GAP_MS {
            issues.push(preflight_issue(
                SubtitleIssueCode::LongGap,
                SubtitleIssueSeverity::Warning,
                Some(current.ordinal),
                Some(previous.ordinal),
                "字幕之间存在超过 30 秒的空白",
            ));
        }
    }

    let first_start_ms = cues.first().map(|cue| cue.start_ms);
    let last_end_ms = cues.last().map(|cue| cue.end_ms);
    if first_start_ms.is_some_and(|start_ms| start_ms > LONG_GAP_MS) {
        issues.push(preflight_issue(
            SubtitleIssueCode::LongGap,
            SubtitleIssueSeverity::Warning,
            Some(0),
            None,
            "媒体开始后超过 30 秒才出现第一条字幕",
        ));
    }
    if let (Some(duration_ms), Some(last_end_ms)) = (media_duration_ms, last_end_ms)
        && duration_ms - last_end_ms > LONG_GAP_MS
    {
        issues.push(preflight_issue(
            SubtitleIssueCode::LongGap,
            SubtitleIssueSeverity::Warning,
            cues.last().map(|cue| cue.ordinal),
            None,
            "最后一条字幕距离媒体结束超过 30 秒",
        ));
    }

    let error_count = issues
        .iter()
        .filter(|issue| issue.severity == SubtitleIssueSeverity::Error)
        .count();
    let warning_count = issues.len() - error_count;
    let status = if error_count > 0 {
        SubtitlePreflightStatus::Blocked
    } else if warning_count > 0 {
        SubtitlePreflightStatus::Warning
    } else {
        SubtitlePreflightStatus::Ready
    };
    let covered_ms = cues
        .iter()
        .filter(|cue| cue.end_ms > cue.start_ms)
        .map(|cue| cue.end_ms - cue.start_ms)
        .sum::<i64>();
    let coverage_ratio = media_duration_ms
        .filter(|duration_ms| *duration_ms > 0)
        .map(|duration_ms| (covered_ms as f64 / duration_ms as f64).clamp(0.0, 1.0));

    SubtitlePreflightReport {
        status,
        segment_count: cues.len(),
        error_count,
        warning_count,
        first_start_ms,
        last_end_ms,
        media_duration_ms,
        coverage_ratio,
        issues,
    }
}

fn preflight_issue(
    code: SubtitleIssueCode,
    severity: SubtitleIssueSeverity,
    ordinal: Option<usize>,
    related_ordinal: Option<usize>,
    message: &str,
) -> SubtitlePreflightIssue {
    SubtitlePreflightIssue {
        code,
        severity,
        ordinal,
        related_ordinal,
        message: message.to_owned(),
    }
}

fn canonical_subtitle_path(value: &str) -> Result<PathBuf, SubtitleError> {
    let path = Path::new(value.trim());
    if value.trim().is_empty() || !path.is_file() {
        return Err(SubtitleError::Parse("字幕文件不存在或不是文件".to_owned()));
    }
    dunce::canonicalize(path).map_err(Into::into)
}

fn embedded_source_label(
    stream_index: i64,
    embedded_language: Option<&str>,
    codec_name: &str,
) -> String {
    let language = embedded_language
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" · {}", value.to_ascii_uppercase()))
        .unwrap_or_default();
    format!(
        "内嵌字幕轨 {stream_index}{language} · {}",
        codec_name.to_ascii_uppercase()
    )
}

fn remove_controlled_cache_file(path: &Path, controlled_root: &Path) -> Result<(), SubtitleError> {
    if path.parent() != Some(controlled_root) {
        return Err(StoreError::Validation("拒绝清理不在项目字幕缓存中的文件".to_owned()).into());
    }
    if path.is_file() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn normalize_language_code(value: &str) -> Result<String, SubtitleError> {
    let normalized = value.trim().replace('_', "-").to_ascii_lowercase();
    let valid = (2..=35).contains(&normalized.len())
        && normalized
            .split('-')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_alphanumeric()))
        && normalized
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic());
    if valid {
        Ok(normalized)
    } else {
        Err(SubtitleError::InvalidLanguage(value.to_owned()))
    }
}

fn now_ms() -> Result<i64, StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| StoreError::Validation(format!("系统时间无效：{error}")))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| StoreError::Validation("系统时间超出支持范围".to_owned()))
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command};

    use crate::{domain::CreateLocalProjectInput, media};

    use super::*;

    fn create_store_with_media() -> (tempfile::TempDir, ProjectStore, String) {
        let temp = tempfile::tempdir().expect("temporary directory should be created");
        let media_path = temp.path().join("episode.mp4");
        fs::write(&media_path, b"media").expect("media fixture should be written");
        let store = ProjectStore::open(temp.path().join("projects").join("siaovplay.db"))
            .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: media_path.to_string_lossy().into_owned(),
                title: None,
            })
            .expect("project should be created");
        (temp, store, project.id)
    }

    #[test]
    fn parses_srt_and_webvtt_with_multiline_cues() {
        let srt = parse_srt(
            "\u{feff}1\n00:00:00,000 --> 00:00:01,500\n第一行\n第二行\n\n2\n00:00:01,700 --> 00:00:03,000\n第二句",
        )
        .expect("SRT should parse");
        assert_eq!(srt.len(), 2);
        assert_eq!(srt[0].end_ms, 1_500);
        assert_eq!(srt[0].text, "第一行\n第二行");

        let vtt = parse_vtt(
            "WEBVTT\n\nNOTE metadata\nignored\n\ncue-1\n00:00.000 --> 00:02.000 align:start\nHello",
        )
        .expect("WebVTT should parse");
        assert_eq!(vtt.len(), 1);
        assert_eq!(vtt[0].text, "Hello");
    }

    #[test]
    fn rejects_malformed_timestamps() {
        for value in [
            "00:60:00.000",
            "00:00:60.000",
            "not-a-time",
            "00:00:01.0000",
        ] {
            assert!(parse_timestamp(value).is_err(), "{value}");
        }
    }

    #[test]
    fn preflight_blocks_invalid_content_and_reports_timeline_warnings() {
        let report = inspect_cues(
            &[
                SubtitleCue {
                    ordinal: 0,
                    start_ms: 0,
                    end_ms: 100,
                    text: String::new(),
                    confidence: None,
                },
                SubtitleCue {
                    ordinal: 1,
                    start_ms: 50,
                    end_ms: 20_000,
                    text: "a".repeat(600),
                    confidence: None,
                },
            ],
            Some(10_000),
        );
        assert_eq!(report.status, SubtitlePreflightStatus::Blocked);
        assert!(report.error_count >= 2);
        for code in [
            SubtitleIssueCode::EmptyText,
            SubtitleIssueCode::OutOfBounds,
            SubtitleIssueCode::Overlap,
            SubtitleIssueCode::DurationTooShort,
            SubtitleIssueCode::DurationTooLong,
            SubtitleIssueCode::ReadingSpeedHigh,
        ] {
            assert!(
                report.issues.iter().any(|issue| issue.code == code),
                "missing {code:?}"
            );
        }
    }

    #[test]
    fn stores_each_import_as_an_immutable_version() {
        let (temp, store, project_id) = create_store_with_media();
        let media_sha256 = "a".repeat(64);
        let project = store.get_project(&project_id).expect("project should load");
        store
            .record_media_probe(
                &project_id,
                &project.media_source.id,
                &media_sha256,
                r#"{"containerFormats":["mov"],"durationMs":5000,"sizeBytes":5,"bitRate":null,"videoStreams":[],"audioStreams":[],"subtitleStreams":[]}"#,
                5,
                Some(1),
            )
            .expect("media probe should be recorded");
        let subtitle_path = temp.path().join("captions.srt");
        fs::write(
            &subtitle_path,
            "1\n00:00:00,000 --> 00:00:01,500\nFirst\n\n2\n00:00:01,700 --> 00:00:03,000\nSecond",
        )
        .expect("subtitle should be written");
        let parsed = read_and_parse(&subtitle_path).expect("subtitle should parse");
        let preview = SubtitleImportPreview {
            format: parsed.format,
            source_label: "captions.srt".to_owned(),
            source_sha256: parsed.source_sha256,
            language_code: "en".to_owned(),
            expected_project_revision: 1,
            expected_media_sha256: media_sha256.clone(),
            preflight: inspect_cues(&parsed.cues, Some(5_000)),
            can_import: true,
            cues: parsed.cues,
        };
        let first = persist_import(
            &store,
            &project_id,
            preview,
            SubtitleSourceKind::ImportedFile,
        )
        .expect("first import should work");
        assert_eq!(first.version_number, 1);
        assert_eq!(first.project_revision, 2);
        assert_eq!(first.segments.len(), 2);

        fs::write(&subtitle_path, "1\n00:00:00,000 --> 00:00:02,000\nRevised")
            .expect("revised subtitle should be written");
        let parsed = read_and_parse(&subtitle_path).expect("revised subtitle should parse");
        let preview = SubtitleImportPreview {
            format: parsed.format,
            source_label: "captions.srt".to_owned(),
            source_sha256: parsed.source_sha256,
            language_code: "en".to_owned(),
            expected_project_revision: 2,
            expected_media_sha256: media_sha256,
            preflight: inspect_cues(&parsed.cues, Some(5_000)),
            can_import: true,
            cues: parsed.cues,
        };
        let second = persist_import(
            &store,
            &project_id,
            preview,
            SubtitleSourceKind::ImportedFile,
        )
        .expect("second import should work");
        assert_eq!(second.version_number, 2);
        assert!(second.is_current);

        let versions =
            list_subtitle_versions(&store, &project_id).expect("versions should be listed");
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].segments[0].text, "Revised");
        assert_eq!(versions[1].segments[0].text, "First");
        assert!(!versions[1].is_current);
    }

    #[test]
    #[ignore = "requires SIAOVPLAY_MEDIA_FIXTURE_DIR and the local FFmpeg runtime"]
    fn real_media_subtitle_preview_import_and_change_guard() {
        let fixture_dir = std::env::var_os("SIAOVPLAY_MEDIA_FIXTURE_DIR")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_MEDIA_FIXTURE_DIR must be set");
        let media_path = fixture_dir.join("h264-aac.mp4");
        let temp = tempfile::tempdir().expect("temporary directory should be created");
        let store = ProjectStore::open(temp.path().join("projects").join("siaovplay.db"))
            .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: media_path.to_string_lossy().into_owned(),
                title: Some("subtitle integration".to_owned()),
            })
            .expect("project should be created");
        let subtitle_path = temp.path().join("captions.vtt");
        fs::write(
            &subtitle_path,
            "WEBVTT\n\n00:00.000 --> 00:01.200\nFirst line\n\n00:01.400 --> 00:02.600\nSecond line",
        )
        .expect("subtitle should be written");

        let preview = inspect_subtitle_file(
            &store,
            &InspectSubtitleFileInput {
                project_id: project.id.clone(),
                subtitle_path: subtitle_path.to_string_lossy().into_owned(),
                language_code: "en-US".to_owned(),
            },
        )
        .expect("preview should succeed");
        assert!(preview.can_import);
        assert_eq!(preview.language_code, "en-us");
        assert_eq!(preview.preflight.segment_count, 2);

        let imported = import_subtitle_file(
            &store,
            ImportSubtitleFileInput {
                project_id: project.id.clone(),
                subtitle_path: subtitle_path.to_string_lossy().into_owned(),
                language_code: "en-US".to_owned(),
                expected_source_sha256: preview.source_sha256.clone(),
                expected_media_sha256: preview.expected_media_sha256.clone(),
                expected_project_revision: preview.expected_project_revision,
            },
        )
        .expect("import should succeed");
        assert_eq!(imported.segments.len(), 2);
        assert_eq!(imported.status, "ready");

        fs::write(
            &subtitle_path,
            "WEBVTT\n\n00:00.000 --> 00:01.200\nChanged after preview",
        )
        .expect("subtitle should change");
        let error = import_subtitle_file(
            &store,
            ImportSubtitleFileInput {
                project_id: project.id.clone(),
                subtitle_path: subtitle_path.to_string_lossy().into_owned(),
                language_code: "en-US".to_owned(),
                expected_source_sha256: preview.source_sha256,
                expected_media_sha256: preview.expected_media_sha256,
                expected_project_revision: preview.expected_project_revision,
            },
        )
        .expect_err("changed subtitle must be rejected");
        assert!(matches!(error, SubtitleError::SubtitleSourceChanged));

        fs::write(&subtitle_path, "WEBVTT\n\n00:00.000 --> 00:01.200\n")
            .expect("invalid subtitle should be written");
        let blocked_preview = inspect_subtitle_file(
            &store,
            &InspectSubtitleFileInput {
                project_id: project.id.clone(),
                subtitle_path: subtitle_path.to_string_lossy().into_owned(),
                language_code: "en-US".to_owned(),
            },
        )
        .expect("invalid subtitle should still produce a preflight report");
        assert!(!blocked_preview.can_import);
        let blocked_error = import_subtitle_file(
            &store,
            ImportSubtitleFileInput {
                project_id: project.id.clone(),
                subtitle_path: subtitle_path.to_string_lossy().into_owned(),
                language_code: "en-US".to_owned(),
                expected_source_sha256: blocked_preview.source_sha256,
                expected_media_sha256: blocked_preview.expected_media_sha256,
                expected_project_revision: blocked_preview.expected_project_revision,
            },
        )
        .expect_err("blocked preflight must not be imported");
        assert!(matches!(blocked_error, SubtitleError::PreflightBlocked(_)));
        assert_eq!(
            list_subtitle_versions(&store, &project.id)
                .expect("versions should list")
                .len(),
            1
        );
    }

    #[test]
    #[ignore = "requires SIAOVPLAY_MEDIA_FIXTURE_DIR and the local FFmpeg runtime"]
    fn real_media_embedded_subtitle_is_extracted_preflighted_and_imported() {
        let fixture_dir = std::env::var_os("SIAOVPLAY_MEDIA_FIXTURE_DIR")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_MEDIA_FIXTURE_DIR must be set");
        let source_media = fixture_dir.join("h264-aac.mp4");
        let temp = tempfile::tempdir().expect("temporary directory should be created");
        let source_subtitle = temp.path().join("embedded.srt");
        fs::write(
            &source_subtitle,
            "1\n00:00:00,000 --> 00:00:01,200\n待っていたの？\n\n2\n00:00:01,400 --> 00:00:02,600\n雨が止むと思って。",
        )
        .expect("subtitle should be written");
        let embedded_media = temp.path().join("embedded-subtitle.mkv");
        let runtime = media::media_runtime_status();
        let ffmpeg_path = runtime
            .ffmpeg_path
            .expect("FFmpeg must be available for the real-media test");
        let output = Command::new(ffmpeg_path)
            .args(["-y", "-hide_banner", "-nostdin", "-v", "error", "-i"])
            .arg(&source_media)
            .arg("-i")
            .arg(&source_subtitle)
            .args([
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-map",
                "1:0",
                "-c",
                "copy",
                "-metadata:s:s:0",
                "language=jpn",
            ])
            .arg(&embedded_media)
            .output()
            .expect("FFmpeg should start");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );

        let store = ProjectStore::open(temp.path().join("projects").join("siaovplay.db"))
            .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: embedded_media.to_string_lossy().into_owned(),
                title: Some("embedded subtitle integration".to_owned()),
            })
            .expect("project should be created");
        let inspection =
            media::inspect_project_media(&store, &project.id).expect("media should inspect");
        let stream = inspection
            .probe
            .subtitle_streams
            .first()
            .expect("embedded subtitle stream should be listed");
        assert_eq!(stream.kind, media::EmbeddedSubtitleKind::Text);
        assert_eq!(stream.language.as_deref(), Some("jpn"));

        let preview = inspect_embedded_subtitle(
            &store,
            &InspectEmbeddedSubtitleInput {
                project_id: project.id.clone(),
                stream_index: stream.index,
                language_code: "ja".to_owned(),
            },
        )
        .expect("embedded subtitle should preview");
        assert!(preview.subtitle.can_import);
        assert_eq!(preview.subtitle.preflight.segment_count, 2);
        assert_eq!(preview.embedded_language.as_deref(), Some("jpn"));

        let imported = import_embedded_subtitle(
            &store,
            ImportEmbeddedSubtitleInput {
                project_id: project.id.clone(),
                stream_index: stream.index,
                language_code: "ja".to_owned(),
                expected_source_sha256: preview.subtitle.source_sha256,
                expected_media_sha256: preview.subtitle.expected_media_sha256,
                expected_project_revision: preview.subtitle.expected_project_revision,
            },
        )
        .expect("embedded subtitle should import");
        assert_eq!(imported.source_kind, "embedded");
        assert_eq!(imported.segments.len(), 2);
        assert_eq!(imported.segments[0].text, "待っていたの？");

        let cache_root = store
            .data_directory()
            .join("subtitle-cache")
            .join(&project.id);
        let cached_files = fs::read_dir(cache_root)
            .expect("subtitle cache should exist")
            .collect::<Result<Vec<_>, _>>()
            .expect("subtitle cache should list");
        assert!(
            cached_files.is_empty(),
            "temporary extraction files must be removed"
        );
    }
}
