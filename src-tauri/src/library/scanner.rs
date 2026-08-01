use std::{
    cmp::Ordering,
    collections::HashMap,
    fs::{self, File, Metadata},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        LazyLock,
        atomic::{AtomicBool, Ordering as AtomicOrdering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    EpisodeRecognition, IgnoredEntryReason, IgnoredLibraryEntry, LibraryError,
    LibraryScanCandidate, LibraryScanPhase, LibraryScanProgress,
};

const FINGERPRINT_CHUNK_BYTES: u64 = 1024 * 1024;
const MAX_SCAN_DEPTH: usize = 64;
const MAX_CANDIDATE_FILES: usize = 100_000;
const MAX_IGNORED_DETAILS: usize = 200;
const PROGRESS_INTERVAL: u64 = 32;
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
#[cfg(test)]
const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "mov", "webm", "avi", "m4v", "ts", "mts", "m2ts",
];
const IGNORED_NAMES: &[&str] = &[
    "sample",
    "trailer",
    "extras",
    "featurettes",
    "behind-the-scenes",
    "花絮",
    "预告",
];
const TEMPORARY_EXTENSIONS: &[&str] = &["tmp", "temp", "part", "partial", "download", "crdownload"];

static SXX_EXX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)s(\d{1,3})e(\d{1,4})").expect("valid SxxExx regex"));
static SEASON_X_EPISODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(\d{1,3})x(\d{1,4})").expect("valid 1x02 regex"));
static CHINESE_EPISODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"第\s*(\d{1,4})\s*集").expect("valid Chinese episode regex"));
static NUMERIC_PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(\d{1,4})(?:[\s._-]+|$)").expect("valid numeric prefix regex")
});
static SEASON_DIRECTORY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:season[\s._-]*|s|第\s*)(\d{1,3})(?:\s*季)?$")
        .expect("valid season directory regex")
});
static NATURAL_PART: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d+|\D+").expect("valid natural sort regex"));

#[derive(Debug)]
pub(super) struct ScannedLibraryFolder {
    pub root_path: String,
    pub root_display_name: String,
    pub suggested_collection_title: String,
    pub candidates: Vec<LibraryScanCandidate>,
    pub ignored_entries: Vec<IgnoredLibraryEntry>,
    pub ignored_count: u64,
}

#[derive(Debug)]
pub(super) struct RevalidatedCandidateFile {
    pub canonical_path: PathBuf,
    pub source_size_bytes: u64,
    pub source_modified_at_ms: Option<i64>,
}

#[derive(Default)]
struct ProgressCounters {
    scanned_directories: u64,
    scanned_files: u64,
    candidate_files: u64,
    ignored_entries: u64,
}

struct PendingDirectory {
    path: PathBuf,
    depth: usize,
}

#[derive(Clone, Copy)]
struct ParsedEpisode {
    season_number: Option<i64>,
    episode_number: Option<i64>,
    recognition: EpisodeRecognition,
    needs_confirmation: bool,
    confirmation_reason: Option<&'static str>,
}

pub(super) fn scan_library_folder<F>(
    scan_id: &str,
    root_path: &str,
    cancelled: &AtomicBool,
    mut on_progress: F,
) -> Result<ScannedLibraryFolder, LibraryError>
where
    F: FnMut(LibraryScanProgress),
{
    let canonical_root = canonicalize_authorized_root(root_path)?;
    let root_display_name = canonical_root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("本地媒体")
        .to_owned();
    let mut counters = ProgressCounters::default();
    let mut candidates = Vec::new();
    let mut ignored_entries = Vec::new();
    let mut directories = vec![PendingDirectory {
        path: canonical_root.clone(),
        depth: 0,
    }];

    on_progress(progress(
        scan_id,
        LibraryScanPhase::Scanning,
        &counters,
        None,
        None,
    ));

    while let Some(directory) = directories.pop() {
        ensure_not_cancelled(scan_id, cancelled)?;
        counters.scanned_directories += 1;
        if directory.depth > MAX_SCAN_DEPTH {
            record_ignored(
                &mut ignored_entries,
                &mut counters,
                relative_path(&canonical_root, &directory.path),
                IgnoredEntryReason::Unreadable,
            );
            continue;
        }

        let mut entries = match fs::read_dir(&directory.path) {
            Ok(read_directory) => {
                let mut entries = Vec::new();
                for entry in read_directory {
                    match entry {
                        Ok(entry) => entries.push(entry),
                        Err(_) => record_ignored(
                            &mut ignored_entries,
                            &mut counters,
                            relative_path(&canonical_root, &directory.path),
                            IgnoredEntryReason::Unreadable,
                        ),
                    }
                }
                entries
            }
            Err(_) => {
                record_ignored(
                    &mut ignored_entries,
                    &mut counters,
                    relative_path(&canonical_root, &directory.path),
                    IgnoredEntryReason::Unreadable,
                );
                continue;
            }
        };
        entries.sort_by(|left, right| {
            natural_cmp(
                &left.file_name().to_string_lossy(),
                &right.file_name().to_string_lossy(),
            )
        });

        let mut child_directories = Vec::new();
        for entry in entries {
            ensure_not_cancelled(scan_id, cancelled)?;
            let path = entry.path();
            let relative = relative_path(&canonical_root, &path);
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    record_ignored(
                        &mut ignored_entries,
                        &mut counters,
                        relative,
                        IgnoredEntryReason::Unreadable,
                    );
                    continue;
                }
            };

            if let Some(reason) = ignored_reason(&path, &metadata) {
                record_ignored(&mut ignored_entries, &mut counters, relative, reason);
                continue;
            }
            if metadata.is_dir() {
                child_directories.push(PendingDirectory {
                    path,
                    depth: directory.depth + 1,
                });
                continue;
            }
            if !metadata.is_file() {
                record_ignored(
                    &mut ignored_entries,
                    &mut counters,
                    relative,
                    IgnoredEntryReason::Unreadable,
                );
                continue;
            }

            counters.scanned_files += 1;
            if !is_supported_video(&path) {
                record_ignored(
                    &mut ignored_entries,
                    &mut counters,
                    relative.clone(),
                    IgnoredEntryReason::UnsupportedExtension,
                );
                maybe_emit_progress(scan_id, &counters, &relative, false, &mut on_progress);
                continue;
            }
            if candidates.len() >= MAX_CANDIDATE_FILES {
                return Err(LibraryError::Validation(format!(
                    "单次扫描最多支持 {MAX_CANDIDATE_FILES} 个视频文件"
                )));
            }

            let canonical_file = match dunce::canonicalize(&path) {
                Ok(path) => path,
                Err(_) => {
                    record_ignored(
                        &mut ignored_entries,
                        &mut counters,
                        relative,
                        IgnoredEntryReason::Unreadable,
                    );
                    continue;
                }
            };
            if !canonical_file.starts_with(&canonical_root) {
                record_ignored(
                    &mut ignored_entries,
                    &mut counters,
                    relative,
                    IgnoredEntryReason::OutsideRoot,
                );
                continue;
            }

            on_progress(progress(
                scan_id,
                LibraryScanPhase::Fingerprinting,
                &counters,
                Some(relative.clone()),
                None,
            ));
            let fingerprint = quick_fingerprint(&canonical_file, &metadata, cancelled)?;
            let metadata_after = fs::metadata(&canonical_file)?;
            if metadata.len() != metadata_after.len()
                || modified_at_ms(&metadata) != modified_at_ms(&metadata_after)
            {
                return Err(LibraryError::Conflict(format!(
                    "扫描期间文件发生变化：{relative}"
                )));
            }

            let parsed = parse_episode(&canonical_root, &canonical_file);
            counters.candidate_files += 1;
            candidates.push(LibraryScanCandidate {
                candidate_id: Uuid::new_v4().to_string(),
                relative_path: relative.clone(),
                display_title: display_title(&canonical_file),
                season_number: parsed.season_number,
                episode_number: parsed.episode_number,
                absolute_order: 0,
                recognition: parsed.recognition,
                needs_confirmation: parsed.needs_confirmation,
                confirmation_reason: parsed.confirmation_reason.map(str::to_owned),
                source_size_bytes: metadata.len(),
                source_modified_at_ms: modified_at_ms(&metadata),
                quick_fingerprint: fingerprint,
            });
            maybe_emit_progress(scan_id, &counters, &relative, false, &mut on_progress);
        }

        for child in child_directories.into_iter().rev() {
            directories.push(child);
        }
    }

    candidates.sort_by(|left, right| natural_cmp(&left.relative_path, &right.relative_path));
    mark_duplicate_fingerprints(&mut candidates);
    for (index, candidate) in candidates.iter_mut().enumerate() {
        candidate.absolute_order = i64::try_from(index)
            .map_err(|_| LibraryError::Conflict("扫描结果数量超出支持范围".to_owned()))?;
    }
    on_progress(progress(
        scan_id,
        LibraryScanPhase::Completed,
        &counters,
        None,
        None,
    ));

    Ok(ScannedLibraryFolder {
        root_path: canonical_root.to_string_lossy().into_owned(),
        root_display_name: root_display_name.clone(),
        suggested_collection_title: root_display_name,
        candidates,
        ignored_entries,
        ignored_count: counters.ignored_entries,
    })
}

pub(super) fn canonicalize_authorized_root(root_path: &str) -> Result<PathBuf, LibraryError> {
    let root_path = root_path.trim();
    if root_path.is_empty() {
        return Err(LibraryError::Validation("媒体库文件夹不能为空".to_owned()));
    }
    let requested_root = PathBuf::from(root_path);
    let requested_metadata = fs::symlink_metadata(&requested_root)?;
    if !requested_metadata.is_dir() {
        return Err(LibraryError::Validation(
            "媒体库路径必须是现有文件夹".to_owned(),
        ));
    }
    if is_reparse_or_symlink(&requested_metadata) {
        return Err(LibraryError::Validation(
            "不能将符号链接或重解析点直接授权为媒体库根目录".to_owned(),
        ));
    }
    dunce::canonicalize(requested_root).map_err(Into::into)
}

pub(super) fn revalidate_candidate(
    root: &Path,
    candidate: &LibraryScanCandidate,
) -> Result<RevalidatedCandidateFile, LibraryError> {
    let relative = Path::new(&candidate.relative_path);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(LibraryError::Validation(format!(
            "扫描结果包含不安全的相对路径：{}",
            candidate.relative_path
        )));
    }
    let joined = root.join(relative);
    let metadata = fs::symlink_metadata(&joined)?;
    if !metadata.is_file() || is_reparse_or_symlink(&metadata) {
        return Err(LibraryError::Conflict(format!(
            "扫描后的文件已经不可用：{}",
            candidate.relative_path
        )));
    }
    let canonical_path = dunce::canonicalize(&joined)?;
    if !canonical_path.starts_with(root) {
        return Err(LibraryError::Validation(format!(
            "扫描后的文件已经移出授权目录：{}",
            candidate.relative_path
        )));
    }
    if metadata.len() != candidate.source_size_bytes
        || modified_at_ms(&metadata) != candidate.source_modified_at_ms
    {
        return Err(LibraryError::Conflict(format!(
            "扫描后的文件元数据已经变化：{}",
            candidate.relative_path
        )));
    }
    let cancelled = AtomicBool::new(false);
    let fingerprint = quick_fingerprint(&canonical_path, &metadata, &cancelled)?;
    let metadata_after = fs::metadata(&canonical_path)?;
    if metadata.len() != metadata_after.len()
        || modified_at_ms(&metadata) != modified_at_ms(&metadata_after)
        || fingerprint != candidate.quick_fingerprint
    {
        return Err(LibraryError::Conflict(format!(
            "扫描后的文件内容已经变化：{}",
            candidate.relative_path
        )));
    }
    Ok(RevalidatedCandidateFile {
        canonical_path,
        source_size_bytes: metadata.len(),
        source_modified_at_ms: modified_at_ms(&metadata),
    })
}

fn parse_episode(root: &Path, file: &Path) -> ParsedEpisode {
    let stem = file
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let directory_season = season_from_directories(root, file.parent());
    let mut matches = Vec::new();
    collect_two_number_matches(&SXX_EXX, stem, EpisodeRecognition::SxxExx, &mut matches);
    collect_two_number_matches(
        &SEASON_X_EPISODE,
        stem,
        EpisodeRecognition::SeasonXEpisode,
        &mut matches,
    );
    collect_one_number_matches(
        &CHINESE_EPISODE,
        stem,
        EpisodeRecognition::ChineseEpisode,
        directory_season,
        &mut matches,
    );
    collect_one_number_matches(
        &NUMERIC_PREFIX,
        stem,
        if directory_season.is_some() {
            EpisodeRecognition::SeasonDirectory
        } else {
            EpisodeRecognition::NumericPrefix
        },
        directory_season,
        &mut matches,
    );

    if let Some(first) = matches.first().copied() {
        if directory_season.is_some()
            && first.season_number.is_some()
            && directory_season != first.season_number
        {
            return ParsedEpisode {
                season_number: first.season_number,
                episode_number: first.episode_number,
                recognition: EpisodeRecognition::Conflict,
                needs_confirmation: true,
                confirmation_reason: Some("文件名季号与所在季目录冲突"),
            };
        }
        if matches.iter().any(|candidate| {
            candidate.season_number != first.season_number
                || candidate.episode_number != first.episode_number
        }) {
            return ParsedEpisode {
                season_number: first.season_number,
                episode_number: first.episode_number,
                recognition: EpisodeRecognition::Conflict,
                needs_confirmation: true,
                confirmation_reason: Some("文件名中存在互相冲突的季集编号"),
            };
        }
        return first;
    }

    ParsedEpisode {
        season_number: directory_season,
        episode_number: None,
        recognition: if directory_season.is_some() {
            EpisodeRecognition::SeasonDirectory
        } else {
            EpisodeRecognition::Unresolved
        },
        needs_confirmation: true,
        confirmation_reason: Some("没有识别到明确集号"),
    }
}

fn collect_two_number_matches(
    regex: &Regex,
    value: &str,
    recognition: EpisodeRecognition,
    matches: &mut Vec<ParsedEpisode>,
) {
    for captures in regex.captures_iter(value) {
        let Some(season_number) = parse_capture(&captures, 1) else {
            continue;
        };
        let Some(episode_number) = parse_capture(&captures, 2) else {
            continue;
        };
        matches.push(ParsedEpisode {
            season_number: Some(season_number),
            episode_number: Some(episode_number),
            recognition,
            needs_confirmation: false,
            confirmation_reason: None,
        });
    }
}

fn collect_one_number_matches(
    regex: &Regex,
    value: &str,
    recognition: EpisodeRecognition,
    season_number: Option<i64>,
    matches: &mut Vec<ParsedEpisode>,
) {
    for captures in regex.captures_iter(value) {
        let Some(episode_number) = parse_capture(&captures, 1) else {
            continue;
        };
        matches.push(ParsedEpisode {
            season_number,
            episode_number: Some(episode_number),
            recognition,
            needs_confirmation: false,
            confirmation_reason: None,
        });
    }
}

fn parse_capture(captures: &regex::Captures<'_>, index: usize) -> Option<i64> {
    captures.get(index)?.as_str().parse().ok()
}

fn season_from_directories(root: &Path, parent: Option<&Path>) -> Option<i64> {
    let parent = parent?;
    let relative = parent.strip_prefix(root).ok()?;
    relative.components().rev().find_map(|component| {
        let value = component.as_os_str().to_string_lossy();
        SEASON_DIRECTORY
            .captures(&value)
            .and_then(|captures| parse_capture(&captures, 1))
    })
}

fn ignored_reason(path: &Path, metadata: &Metadata) -> Option<IgnoredEntryReason> {
    if is_reparse_or_symlink(metadata) {
        return Some(IgnoredEntryReason::ReparsePoint);
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if name.starts_with('.') || has_windows_attribute(metadata, FILE_ATTRIBUTE_HIDDEN) {
        return Some(IgnoredEntryReason::Hidden);
    }
    if has_windows_attribute(metadata, FILE_ATTRIBUTE_SYSTEM) {
        return Some(IgnoredEntryReason::System);
    }
    let stem = if metadata.is_dir() {
        name
    } else {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(name)
    };
    if IGNORED_NAMES
        .iter()
        .any(|ignored| stem.eq_ignore_ascii_case(ignored))
    {
        return Some(IgnoredEntryReason::IgnoredName);
    }
    if metadata.is_file() && is_temporary(path) {
        return Some(IgnoredEntryReason::Temporary);
    }
    None
}

fn is_supported_video(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            VIDEO_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn is_temporary(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if name.starts_with("~$") || name.ends_with('~') {
        return true;
    }
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            TEMPORARY_EXTENSIONS
                .iter()
                .any(|temporary| extension.eq_ignore_ascii_case(temporary))
        })
}

fn quick_fingerprint(
    path: &Path,
    metadata: &Metadata,
    cancelled: &AtomicBool,
) -> Result<String, LibraryError> {
    let mut file = File::open(path)?;
    let size = metadata.len();
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());
    if size < FINGERPRINT_CHUNK_BYTES * 2 {
        hash_bytes(&mut file, size, cancelled, &mut hasher)?;
    } else {
        hash_bytes(&mut file, FINGERPRINT_CHUNK_BYTES, cancelled, &mut hasher)?;
        file.seek(SeekFrom::Start(size - FINGERPRINT_CHUNK_BYTES))?;
        hash_bytes(&mut file, FINGERPRINT_CHUNK_BYTES, cancelled, &mut hasher)?;
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn mark_duplicate_fingerprints(candidates: &mut [LibraryScanCandidate]) {
    let mut indexes_by_fingerprint = HashMap::<String, Vec<usize>>::new();
    for (index, candidate) in candidates.iter().enumerate() {
        indexes_by_fingerprint
            .entry(candidate.quick_fingerprint.clone())
            .or_default()
            .push(index);
    }
    for indexes in indexes_by_fingerprint
        .values()
        .filter(|indexes| indexes.len() > 1)
    {
        for index in indexes {
            let candidate = &mut candidates[*index];
            candidate.needs_confirmation = true;
            if candidate.confirmation_reason.is_none() {
                candidate.confirmation_reason = Some("存在内容指纹相同但路径不同的视频".to_owned());
            }
        }
    }
}

fn hash_bytes(
    file: &mut File,
    mut remaining: u64,
    cancelled: &AtomicBool,
    hasher: &mut Sha256,
) -> Result<(), LibraryError> {
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        ensure_not_cancelled("fingerprint", cancelled)?;
        let requested = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| LibraryError::Conflict("文件过大，无法计算快速指纹".to_owned()))?;
        let read = file.read(&mut buffer[..requested])?;
        if read == 0 {
            return Err(LibraryError::Conflict(
                "文件在计算快速指纹时被截断".to_owned(),
            ));
        }
        hasher.update(&buffer[..read]);
        remaining -= read as u64;
    }
    Ok(())
}

fn record_ignored(
    entries: &mut Vec<IgnoredLibraryEntry>,
    counters: &mut ProgressCounters,
    relative_path: String,
    reason: IgnoredEntryReason,
) {
    counters.ignored_entries += 1;
    if entries.len() < MAX_IGNORED_DETAILS {
        entries.push(IgnoredLibraryEntry {
            relative_path,
            reason,
        });
    }
}

fn maybe_emit_progress<F>(
    scan_id: &str,
    counters: &ProgressCounters,
    relative_path: &str,
    force: bool,
    on_progress: &mut F,
) where
    F: FnMut(LibraryScanProgress),
{
    let total = counters.scanned_files + counters.scanned_directories;
    if force || total % PROGRESS_INTERVAL == 0 {
        on_progress(progress(
            scan_id,
            LibraryScanPhase::Scanning,
            counters,
            Some(relative_path.to_owned()),
            None,
        ));
    }
}

fn progress(
    scan_id: &str,
    phase: LibraryScanPhase,
    counters: &ProgressCounters,
    current_relative_path: Option<String>,
    message: Option<String>,
) -> LibraryScanProgress {
    LibraryScanProgress {
        scan_id: scan_id.to_owned(),
        phase,
        scanned_directories: counters.scanned_directories,
        scanned_files: counters.scanned_files,
        candidate_files: counters.candidate_files,
        ignored_entries: counters.ignored_entries,
        current_relative_path,
        message,
    }
}

fn ensure_not_cancelled(scan_id: &str, cancelled: &AtomicBool) -> Result<(), LibraryError> {
    if cancelled.load(AtomicOrdering::Relaxed) {
        return Err(LibraryError::ScanCancelled(scan_id.to_owned()));
    }
    Ok(())
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn display_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名单集")
        .replace(['.', '_'], " ")
        .trim()
        .to_owned()
}

fn modified_at_ms(metadata: &Metadata) -> Option<i64> {
    metadata.modified().ok().and_then(system_time_ms)
}

fn system_time_ms(value: SystemTime) -> Option<i64> {
    let duration = value.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

fn natural_cmp(left: &str, right: &str) -> Ordering {
    let left_lower = left.to_lowercase();
    let right_lower = right.to_lowercase();
    let mut left_parts = NATURAL_PART.find_iter(&left_lower);
    let mut right_parts = NATURAL_PART.find_iter(&right_lower);
    loop {
        match (left_parts.next(), right_parts.next()) {
            (Some(left), Some(right)) => {
                let left = left.as_str();
                let right = right.as_str();
                let ordering = if left.as_bytes()[0].is_ascii_digit()
                    && right.as_bytes()[0].is_ascii_digit()
                {
                    numeric_string_cmp(left, right)
                } else {
                    left.cmp(right)
                };
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
            (Some(_), None) => return Ordering::Greater,
            (None, Some(_)) => return Ordering::Less,
            (None, None) => return left.cmp(right),
        }
    }
}

fn numeric_string_cmp(left: &str, right: &str) -> Ordering {
    let left_value = left.trim_start_matches('0');
    let right_value = right.trim_start_matches('0');
    let left_value = if left_value.is_empty() {
        "0"
    } else {
        left_value
    };
    let right_value = if right_value.is_empty() {
        "0"
    } else {
        right_value
    };
    left_value
        .len()
        .cmp(&right_value.len())
        .then_with(|| left_value.cmp(right_value))
        .then_with(|| left.len().cmp(&right.len()))
}

#[cfg(windows)]
fn has_windows_attribute(metadata: &Metadata, attribute: u32) -> bool {
    use std::os::windows::fs::MetadataExt;

    metadata.file_attributes() & attribute != 0
}

#[cfg(not(windows))]
fn has_windows_attribute(_metadata: &Metadata, _attribute: u32) -> bool {
    false
}

fn is_reparse_or_symlink(metadata: &Metadata) -> bool {
    metadata.file_type().is_symlink()
        || has_windows_attribute(metadata, FILE_ATTRIBUTE_REPARSE_POINT)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use tempfile::TempDir;

    use super::*;

    fn media(root: &Path, relative: &str, bytes: &[u8]) -> PathBuf {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().expect("fixture parent")).expect("create parent");
        fs::write(&path, bytes).expect("write fixture");
        path
    }

    fn scan(root: &Path) -> ScannedLibraryFolder {
        scan_library_folder(
            "00000000-0000-4000-8000-000000000001",
            &root.to_string_lossy(),
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("scan should succeed")
    }

    #[test]
    fn parses_supported_episode_patterns_and_conflicts() {
        let root = TempDir::new().expect("temp root");
        let cases = [
            (
                "Show.S01E02.mkv",
                Some(1),
                Some(2),
                EpisodeRecognition::SxxExx,
            ),
            (
                "Show.1x03.mp4",
                Some(1),
                Some(3),
                EpisodeRecognition::SeasonXEpisode,
            ),
            (
                "第 4 集.mp4",
                None,
                Some(4),
                EpisodeRecognition::ChineseEpisode,
            ),
            (
                "05 - 标题.mkv",
                None,
                Some(5),
                EpisodeRecognition::NumericPrefix,
            ),
            (
                "Season 2/06 - 标题.mp4",
                Some(2),
                Some(6),
                EpisodeRecognition::SeasonDirectory,
            ),
        ];
        for (relative, _, _, _) in cases {
            media(root.path(), relative, relative.as_bytes());
        }
        media(root.path(), "Show.S01E02.1x03.mp4", b"conflict");
        media(
            root.path(),
            "Season 2/Show.S01E02.mp4",
            b"directory-conflict",
        );
        media(root.path(), "special.mp4", b"unresolved");

        let result = scan(root.path());
        for (relative, season, episode, recognition) in cases {
            let candidate = result
                .candidates
                .iter()
                .find(|candidate| candidate.relative_path == relative.replace('\\', "/"))
                .expect("parsed candidate");
            assert_eq!(candidate.season_number, season);
            assert_eq!(candidate.episode_number, episode);
            assert_eq!(candidate.recognition, recognition);
            assert!(!candidate.needs_confirmation);
        }
        let conflict = result
            .candidates
            .iter()
            .find(|candidate| candidate.relative_path.contains("S01E02.1x03"))
            .expect("conflict candidate");
        assert_eq!(conflict.recognition, EpisodeRecognition::Conflict);
        assert!(conflict.needs_confirmation);
        let directory_conflict = result
            .candidates
            .iter()
            .find(|candidate| candidate.relative_path == "Season 2/Show.S01E02.mp4")
            .expect("directory conflict candidate");
        assert_eq!(directory_conflict.recognition, EpisodeRecognition::Conflict);
        assert!(directory_conflict.needs_confirmation);
        let unresolved = result
            .candidates
            .iter()
            .find(|candidate| candidate.relative_path == "special.mp4")
            .expect("unresolved candidate");
        assert_eq!(unresolved.recognition, EpisodeRecognition::Unresolved);
        assert!(unresolved.needs_confirmation);
    }

    #[test]
    fn scans_in_natural_order_and_applies_ignore_rules() {
        let root = TempDir::new().expect("temp root");
        media(root.path(), "10 - finale.mp4", b"10");
        media(root.path(), "2 - second.mp4", b"2");
        media(root.path(), "01 - first.mp4", b"1");
        media(root.path(), ".hidden/03.mp4", b"hidden");
        media(root.path(), "extras/04.mp4", b"extra");
        media(root.path(), "sample.mp4", b"sample");
        media(root.path(), "05.part", b"temporary");
        media(root.path(), "notes.txt", b"notes");
        media(root.path(), "06 - duplicate.mp4", b"same-content");
        media(root.path(), "07 - duplicate.mp4", b"same-content");

        let result = scan(root.path());
        assert_eq!(
            result
                .candidates
                .iter()
                .map(|candidate| candidate.relative_path.as_str())
                .collect::<Vec<_>>(),
            [
                "01 - first.mp4",
                "2 - second.mp4",
                "06 - duplicate.mp4",
                "07 - duplicate.mp4",
                "10 - finale.mp4"
            ]
        );
        assert_eq!(
            result
                .candidates
                .iter()
                .map(|candidate| candidate.absolute_order)
                .collect::<Vec<_>>(),
            [0, 1, 2, 3, 4]
        );
        assert_eq!(result.ignored_count, 5);
        assert!(result.ignored_entries.iter().any(|entry| {
            entry.relative_path == ".hidden" && entry.reason == IgnoredEntryReason::Hidden
        }));
        assert!(result.ignored_entries.iter().any(|entry| {
            entry.relative_path == "extras" && entry.reason == IgnoredEntryReason::IgnoredName
        }));
        assert!(
            result
                .candidates
                .iter()
                .filter(|candidate| candidate.relative_path.contains("duplicate"))
                .all(|candidate| candidate.needs_confirmation)
        );
    }

    #[test]
    fn cancellation_stops_before_reading_files() {
        let root = TempDir::new().expect("temp root");
        media(root.path(), "S01E01.mp4", b"video");
        let cancelled = AtomicBool::new(true);
        let result = scan_library_folder(
            "00000000-0000-4000-8000-000000000002",
            &root.path().to_string_lossy(),
            &cancelled,
            |_| {},
        );
        assert!(matches!(result, Err(LibraryError::ScanCancelled(_))));
    }

    #[test]
    fn quick_fingerprint_changes_with_sampled_content_and_size() {
        let root = TempDir::new().expect("temp root");
        let path = media(root.path(), "S01E01.mp4", b"first");
        let first = quick_fingerprint(
            &path,
            &fs::metadata(&path).expect("metadata"),
            &AtomicBool::new(false),
        )
        .expect("fingerprint");
        fs::write(&path, b"second").expect("replace fixture");
        let second = quick_fingerprint(
            &path,
            &fs::metadata(&path).expect("metadata"),
            &AtomicBool::new(false),
        )
        .expect("fingerprint");
        assert_ne!(first, second);
    }

    #[test]
    fn large_quick_fingerprint_samples_only_the_first_and_last_mebibyte() {
        let root = TempDir::new().expect("temp root");
        let path = root.path().join("large.mp4");
        let mut bytes = vec![0_u8; (FINGERPRINT_CHUNK_BYTES * 2 + 256) as usize];
        bytes[0] = 1;
        let last = bytes.len() - 1;
        bytes[last] = 2;
        fs::write(&path, &bytes).expect("write large fixture");
        let original = quick_fingerprint(
            &path,
            &fs::metadata(&path).expect("metadata"),
            &AtomicBool::new(false),
        )
        .expect("original fingerprint");

        bytes[FINGERPRINT_CHUNK_BYTES as usize + 64] = 3;
        fs::write(&path, &bytes).expect("change unsampled middle");
        let middle_changed = quick_fingerprint(
            &path,
            &fs::metadata(&path).expect("metadata"),
            &AtomicBool::new(false),
        )
        .expect("middle fingerprint");
        assert_eq!(original, middle_changed);

        bytes[1] = 4;
        fs::write(&path, &bytes).expect("change sampled beginning");
        let edge_changed = quick_fingerprint(
            &path,
            &fs::metadata(&path).expect("metadata"),
            &AtomicBool::new(false),
        )
        .expect("edge fingerprint");
        assert_ne!(original, edge_changed);
    }

    #[cfg(windows)]
    #[test]
    fn windows_hidden_and_system_directories_are_not_entered() {
        let root = TempDir::new().expect("temp root");
        let hidden = root.path().join("hidden-attribute");
        let system = root.path().join("system-attribute");
        media(&hidden, "S01E01.mp4", b"hidden");
        media(&system, "S01E02.mp4", b"system");
        set_windows_attributes(&hidden, FILE_ATTRIBUTE_HIDDEN).expect("set hidden attribute");
        set_windows_attributes(&system, FILE_ATTRIBUTE_SYSTEM).expect("set system attribute");

        let result = scan(root.path());
        set_windows_attributes(&hidden, FILE_ATTRIBUTE_NORMAL).expect("clear hidden attribute");
        set_windows_attributes(&system, FILE_ATTRIBUTE_NORMAL).expect("clear system attribute");
        assert!(result.candidates.is_empty());
        assert!(result.ignored_entries.iter().any(|entry| {
            entry.relative_path == "hidden-attribute" && entry.reason == IgnoredEntryReason::Hidden
        }));
        assert!(result.ignored_entries.iter().any(|entry| {
            entry.relative_path == "system-attribute" && entry.reason == IgnoredEntryReason::System
        }));
    }

    #[test]
    fn reparse_or_symlink_escape_is_not_followed() {
        let root = TempDir::new().expect("temp root");
        let outside = TempDir::new().expect("outside root");
        media(outside.path(), "S01E99.mp4", b"outside");
        let link = root.path().join("linked");
        if create_directory_link(outside.path(), &link).is_err() {
            return;
        }

        let result = scan(root.path());
        assert!(result.candidates.is_empty());
        assert!(result.ignored_entries.iter().any(|entry| {
            entry.relative_path == "linked" && entry.reason == IgnoredEntryReason::ReparsePoint
        }));
    }

    #[test]
    #[ignore = "requires an authorized directory in SIAOVPLAY_LIBRARY_SCAN_VALIDATION_DIR"]
    fn scans_authorized_directory_without_changing_source_files() {
        let root = std::env::var_os("SIAOVPLAY_LIBRARY_SCAN_VALIDATION_DIR")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_LIBRARY_SCAN_VALIDATION_DIR must point to an authorized fixture");
        let before = full_source_manifest(&root);
        let result = scan(&root);
        let after = full_source_manifest(&root);

        assert_eq!(before, after, "scanner must not change source files");
        assert!(
            !result.candidates.is_empty(),
            "fixture should contain videos"
        );
        println!(
            "scan root={} candidates={} ignored={} needs_confirmation={}",
            result.root_path,
            result.candidates.len(),
            result.ignored_count,
            result
                .candidates
                .iter()
                .filter(|candidate| candidate.needs_confirmation)
                .count()
        );
    }

    fn full_source_manifest(root: &Path) -> Vec<(String, u64, String)> {
        let mut pending = vec![root.to_owned()];
        let mut manifest = Vec::new();
        while let Some(directory) = pending.pop() {
            let mut entries = fs::read_dir(&directory)
                .expect("read validation directory")
                .map(|entry| entry.expect("read validation entry"))
                .collect::<Vec<_>>();
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let metadata = fs::symlink_metadata(entry.path()).expect("validation metadata");
                if is_reparse_or_symlink(&metadata) {
                    continue;
                }
                if metadata.is_dir() {
                    pending.push(entry.path());
                } else if metadata.is_file() {
                    let bytes = fs::read(entry.path()).expect("read validation file");
                    manifest.push((
                        relative_path(root, &entry.path()),
                        metadata.len(),
                        format!("{:x}", Sha256::digest(bytes)),
                    ));
                }
            }
        }
        manifest.sort_by(|left, right| natural_cmp(&left.0, &right.0));
        manifest
    }

    #[cfg(windows)]
    fn create_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
    }

    #[cfg(windows)]
    fn set_windows_attributes(path: &Path, attributes: u32) -> std::io::Result<()> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::SetFileAttributesW;

        let wide = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let result = unsafe { SetFileAttributesW(wide.as_ptr(), attributes) };
        if result == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    #[cfg(unix)]
    fn create_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }
}
