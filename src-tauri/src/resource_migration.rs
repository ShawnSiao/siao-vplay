mod maintenance;
pub(crate) mod move_control;
mod move_io;
mod move_commit;
mod move_staging;
pub use maintenance::{adopt_local_resources, move_resource_root, reconnect_resource_root, cleanup_unused_resources};

use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs::{self, File},
    io,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;
use uuid::Uuid;

#[cfg(test)]
use std::io::Write;

use crate::{
    local_resources::{self, LocalResourceConfiguration, LocalResourceError, ReceiptFile},
    resource_download::{self, ResourceDownloadError},
    runtime::RuntimeError,
};

const MOVE_MARGIN_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SCAN_DEPTH: usize = 10;
const MAX_SCAN_ENTRIES: usize = 100_000;

#[derive(Debug, Error)]
pub enum ResourceMigrationError {
    #[error(transparent)]
    LocalResource(#[from] LocalResourceError),
    #[error(transparent)]
    Download(#[from] ResourceDownloadError),
    #[error(transparent)]
    Runtime(#[from] RuntimeError),
    #[error("资源迁移文件操作失败：{0}")]
    FileSystem(#[from] io::Error),
    #[error("资源迁移数据无效：{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("执行此资源操作前需要明确确认")]
    ConfirmationRequired,
    #[error("候选资源目录无效：{0}")]
    InvalidSource(String),
    #[error("目标资源目录已存在，请选择空的新位置或使用重新连接：{0}")]
    DestinationExists(String),
    #[error("资源正在准备，当前不能移动或清理")]
    Busy,
    #[error("资源复制已取消，原保存位置保持不变")]
    Cancelled,
    #[error("资源移动空间不足：需要 {required_bytes} 字节，可用 {available_bytes} 字节")]
    InsufficientSpace {
        required_bytes: u64,
        available_bytes: u64,
    },
    #[error("资源迁移完整性校验失败：{0}")]
    Integrity(String),
}

impl ResourceMigrationError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::LocalResource(LocalResourceError::RootUnavailable(_)) => "root_unavailable",
            Self::LocalResource(_) => "local_resource_error",
            Self::Download(error) => error.code(),
            Self::Runtime(_) => "runtime_storage_root_invalid",
            Self::FileSystem(_) => "local_resource_filesystem_error",
            Self::Serialization(_) => "local_resource_serialization_error",
            Self::ConfirmationRequired => "local_resource_confirmation_required",
            Self::InvalidSource(_) => "local_resource_candidate_invalid",
            Self::DestinationExists(_) => "local_resource_destination_exists",
            Self::Busy => "local_resource_busy",
            Self::Cancelled => "local_resource_move_cancelled",
            Self::InsufficientSpace { .. } => "local_resource_space_insufficient",
            Self::Integrity(_) => "local_resource_integrity_failed",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectResourceMigrationInput {
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub source_kind: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptLocalResourcesInput {
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub source_kind: Option<String>,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMigrationSource {
    pub kind: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMigrationCandidate {
    pub source_kind: String,
    pub source_root: String,
    pub resource_id: String,
    pub resource_path: String,
    pub state: String,
    pub reusable_bytes: u64,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMigrationPreview {
    pub sources: Vec<ResourceMigrationSource>,
    pub candidates: Vec<ResourceMigrationCandidate>,
    pub verified_resource_ids: Vec<String>,
    pub reusable_bytes: u64,
    pub rejected_count: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAdoptionResult {
    pub adopted_resource_ids: Vec<String>,
    pub already_active_resource_ids: Vec<String>,
    pub rejected_resource_ids: Vec<String>,
    pub reusable_bytes: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveLocalResourceRootInput {
    pub parent_path: String,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceMovePlan {
    pub previous_root: String,
    pub selected_parent: String,
    pub resource_root: String,
    pub bytes_to_copy: u64,
    pub file_count: usize,
    pub free_space_bytes: Option<u64>,
    pub cross_volume: bool,
    pub destination_exists: bool,
    pub confirmation_required: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceMoveResult {
    pub previous_root: String,
    pub current_root: String,
    pub copied_bytes: u64,
    pub verified_file_count: usize,
    pub cross_volume: bool,
    pub previous_root_retained: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectLocalResourceRootInput {
    pub parent_path: String,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupUnusedResourcesInput {
    pub plan_fingerprint: String,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmLocalResourceOperationInput {
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct UnusedResourceCleanupPlan {
    #[cfg_attr(test, schemars(regex(pattern = "^[a-f0-9]{64}$")))]
    pub plan_fingerprint: String,
    pub resource_ids: Vec<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub reclaimable_bytes: u64,
    pub confirmation_required: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct UnusedResourceCleanupResult {
    pub removed_resource_ids: Vec<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub reclaimed_bytes: u64,
}

#[derive(Clone, Debug)]
enum CandidatePayload {
    File(PathBuf),
    Directory {
        path: PathBuf,
        expected_manifest: Option<Vec<ReceiptFile>>,
        included_files: Option<Vec<String>>,
    },
}

#[derive(Clone, Debug)]
struct VerifiedCandidate {
    public: ResourceMigrationCandidate,
    payload: CandidatePayload,
}

#[derive(Clone, Debug)]
struct CandidateSource {
    kind: String,
    root: PathBuf,
}

#[derive(Default)]
struct ScannedSource {
    files: Vec<PathBuf>,
}

pub fn inspect_resource_migration(
    input: InspectResourceMigrationInput,
) -> Result<ResourceMigrationPreview, ResourceMigrationError> {
    let sources = candidate_sources(input.source_path.as_deref(), input.source_kind.as_deref())?;
    let (verified, rejected) = inspect_sources(&sources)?;
    let mut verified_resource_ids = verified
        .iter()
        .map(|candidate| candidate.public.resource_id.clone())
        .collect::<Vec<_>>();
    verified_resource_ids.sort();
    verified_resource_ids.dedup();
    let reusable_bytes = verified
        .iter()
        .map(|candidate| candidate.public.reusable_bytes)
        .sum();
    let mut candidates = verified
        .iter()
        .map(|candidate| candidate.public.clone())
        .chain(rejected.iter().cloned())
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.resource_id
            .cmp(&right.resource_id)
            .then(left.state.cmp(&right.state))
            .then(left.resource_path.cmp(&right.resource_path))
    });
    Ok(ResourceMigrationPreview {
        sources: sources
            .into_iter()
            .map(|source| ResourceMigrationSource {
                kind: source.kind,
                path: path_string(&source.root),
            })
            .collect(),
        candidates,
        verified_resource_ids,
        reusable_bytes,
        rejected_count: rejected.len(),
    })
}


pub fn plan_resource_root_move(
    parent_path: &str,
) -> Result<LocalResourceMovePlan, ResourceMigrationError> {
    let configuration = local_resources::configuration_snapshot()
        .ok_or(LocalResourceError::ConfirmationRequired)?;
    let previous_root = PathBuf::from(&configuration.resource_root);
    if !previous_root.is_dir() {
        return Err(LocalResourceError::RootUnavailable(path_string(&previous_root)).into());
    }
    let (selected_parent, resource_root) = local_resources::selected_location_paths(parent_path)?;
    move_io::validate_destination(&previous_root, &selected_parent)?;
    if paths_equal(&previous_root, &resource_root) {
        return Err(ResourceMigrationError::InvalidSource(
            "新位置与当前资源目录相同".to_owned(),
        ));
    }
    let manifest = move_io::manifest(&previous_root)?;
    let bytes_to_copy = manifest
        .iter()
        .fold(0_u64, |total, file| total.saturating_add(file.size));
    Ok(LocalResourceMovePlan {
        previous_root: path_string(&previous_root),
        selected_parent: path_string(&selected_parent),
        resource_root: path_string(&resource_root),
        bytes_to_copy,
        file_count: manifest.len(),
        free_space_bytes: local_resources::available_space_for(&selected_parent),
        cross_volume: volume_key(&previous_root) != volume_key(&resource_root),
        destination_exists: resource_root.exists(),
        confirmation_required: true,
    })
}



pub fn plan_unused_resource_cleanup() -> Result<UnusedResourceCleanupPlan, ResourceMigrationError> {
    let configuration = local_resources::configuration_snapshot()
        .ok_or(LocalResourceError::ConfirmationRequired)?;
    let root = PathBuf::from(&configuration.resource_root);
    let mut required = BTreeSet::new();
    for capability in &local_resources::catalog()?.capabilities {
        required.extend(local_resources::required_resource_ids(&capability.id)?);
    }
    let mut resource_ids = Vec::new();
    let mut receipts = Vec::new();
    let mut reclaimable_bytes = 0_u64;
    for resource_id in configuration.active_resources.keys() {
        if required.contains(resource_id) {
            continue;
        }
        let Some(receipt) = local_resources::active_receipt(resource_id)? else {
            continue;
        };
        let install = resource_download::join_safe_relative(&root, &receipt.install_relative_path)?;
        if let Some(bytes) = crate::cleanup_confirmation::candidate_bytes(&install, receipt.files.iter().map(|file| file.size)) {
            reclaimable_bytes = reclaimable_bytes.saturating_add(bytes);
            resource_ids.push(resource_id.clone());
            receipts.push(receipt);
        }
    }
    resource_ids.sort();
    let mut plan = UnusedResourceCleanupPlan {
        plan_fingerprint: String::new(),
        resource_ids,
        reclaimable_bytes,
        confirmation_required: true,
    };
    if local_resources::configuration_snapshot().as_ref() != Some(&configuration) {
        return Err(ResourceMigrationError::Busy);
    }
    plan.plan_fingerprint = crate::cleanup_confirmation::fingerprint("unused", &configuration, &plan, &receipts)?;
    Ok(plan)
}


fn candidate_sources(
    selected_path: Option<&str>,
    selected_kind: Option<&str>,
) -> Result<Vec<CandidateSource>, ResourceMigrationError> {
    let mut sources = Vec::new();
    if let Some(selected_path) = selected_path {
        let root = PathBuf::from(selected_path.trim());
        if !root.is_absolute() || !root.is_dir() {
            return Err(ResourceMigrationError::InvalidSource(
                selected_path.to_owned(),
            ));
        }
        let root = dunce::canonicalize(root)?;
        let kind = selected_kind.unwrap_or("selected_directory");
        if kind != "selected_directory" {
            return Err(ResourceMigrationError::InvalidSource(format!(
                "不支持的候选来源类型：{kind}"
            )));
        }
        push_source(&mut sources, kind, root);
    }
    sources.retain(|source| source.root.is_dir());
    Ok(sources)
}

fn push_source(sources: &mut Vec<CandidateSource>, kind: &str, root: PathBuf) {
    if sources
        .iter()
        .any(|source| paths_equal(&source.root, &root))
    {
        return;
    }
    sources.push(CandidateSource {
        kind: kind.to_owned(),
        root,
    });
}

fn inspect_sources(
    sources: &[CandidateSource],
) -> Result<(Vec<VerifiedCandidate>, Vec<ResourceMigrationCandidate>), ResourceMigrationError> {
    let mut verified = Vec::new();
    let mut rejected = Vec::new();
    for source in sources {
        let scanned = scan_source(&source.root)?;
        for resource in &local_resources::catalog()?.resources {
            let (mut found, mut invalid) = inspect_resource_candidate(source, &scanned, resource)?;
            verified.append(&mut found);
            rejected.append(&mut invalid);
        }
    }
    Ok((verified, rejected))
}

fn inspect_resource_candidate(
    source: &CandidateSource,
    scanned: &ScannedSource,
    resource: &crate::local_resources::ResourceDefinition,
) -> Result<(Vec<VerifiedCandidate>, Vec<ResourceMigrationCandidate>), ResourceMigrationError> {
    let mut verified = Vec::new();
    let mut rejected = Vec::new();
    match verified_receipt_candidate(&source.root, resource) {
        Ok(Some(candidate)) => {
            verified.push(public_candidate(source, resource, candidate));
            return Ok((verified, rejected));
        }
        Ok(None) => {}
        Err(error) => rejected.push(ResourceMigrationCandidate {
            source_kind: source.kind.clone(),
            source_root: path_string(&source.root),
            resource_id: resource.id.clone(),
            resource_path: path_string(
                &source
                    .root
                    .join("receipts")
                    .join(&resource.id)
                    .join(format!("{}.json", resource.version)),
            ),
            state: "rejected".to_owned(),
            reusable_bytes: 0,
            message: Some(error.to_string()),
        }),
    }

    let mut payloads = Vec::new();
    if resource.health_check == "whisper-runtime-metadata-and-timeline" {
        for metadata in scanned.files.iter().filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("runtime-metadata.json"))
        }) {
            if let Some(parent) = metadata.parent() {
                payloads.push(CandidatePayload::Directory {
                    path: parent.to_path_buf(),
                    expected_manifest: None,
                    included_files: runtime_included_files(parent).ok(),
                });
            }
        }
    } else if resource.kind != "archive"
        && let Some(file_name) = expected_file_name(resource)
    {
        for path in scanned.files.iter().filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case(&file_name))
        }) {
            payloads.push(CandidatePayload::File(path.clone()));
        }
    }
    for payload in payloads {
        match verify_candidate_payload(resource, &payload) {
            Ok(bytes) => {
                let public = ResourceMigrationCandidate {
                    source_kind: source.kind.clone(),
                    source_root: path_string(&source.root),
                    resource_id: resource.id.clone(),
                    resource_path: path_string(payload.path()),
                    state: "verified".to_owned(),
                    reusable_bytes: bytes,
                    message: None,
                };
                verified.push(VerifiedCandidate { public, payload });
                rejected.clear();
                break;
            }
            Err(error) => rejected.push(ResourceMigrationCandidate {
                source_kind: source.kind.clone(),
                source_root: path_string(&source.root),
                resource_id: resource.id.clone(),
                resource_path: path_string(payload.path()),
                state: "rejected".to_owned(),
                reusable_bytes: 0,
                message: Some(error.to_string()),
            }),
        }
    }
    Ok((verified, rejected))
}

fn public_candidate(
    source: &CandidateSource,
    resource: &crate::local_resources::ResourceDefinition,
    candidate: CandidatePayload,
) -> VerifiedCandidate {
    let reusable_bytes = match &candidate {
        CandidatePayload::Directory {
            expected_manifest: Some(files),
            ..
        } => files.iter().map(|file| file.size).sum(),
        _ => resource.installed_size.unwrap_or(0),
    };
    VerifiedCandidate {
        public: ResourceMigrationCandidate {
            source_kind: source.kind.clone(),
            source_root: path_string(&source.root),
            resource_id: resource.id.clone(),
            resource_path: path_string(candidate.path()),
            state: "verified".to_owned(),
            reusable_bytes,
            message: None,
        },
        payload: candidate,
    }
}

fn verified_receipt_candidate(
    source_root: &Path,
    resource: &crate::local_resources::ResourceDefinition,
) -> Result<Option<CandidatePayload>, ResourceMigrationError> {
    let receipt_path = source_root
        .join("receipts")
        .join(&resource.id)
        .join(format!("{}.json", resource.version));
    if !receipt_path.is_file() {
        return Ok(None);
    }
    let receipt = serde_json::from_slice::<crate::local_resources::ResourceReceipt>(&fs::read(
        receipt_path,
    )?)?;
    local_resources::validate_external_receipt(&receipt, resource)?;
    let payload =
        resource_download::join_safe_relative(source_root, &receipt.install_relative_path)?;
    resource_download::verify_installed_payload(resource, &payload, Some(&receipt.files))?;
    Ok(Some(CandidatePayload::Directory {
        path: payload,
        expected_manifest: Some(receipt.files),
        included_files: None,
    }))
}

impl CandidatePayload {
    fn path(&self) -> &Path {
        match self {
            Self::File(path) | Self::Directory { path, .. } => path,
        }
    }
}

fn verify_candidate_payload(
    resource: &crate::local_resources::ResourceDefinition,
    payload: &CandidatePayload,
) -> Result<u64, ResourceMigrationError> {
    match payload {
        CandidatePayload::File(path) => {
            let artifact = resource.artifact.as_ref().ok_or_else(|| {
                ResourceMigrationError::Integrity(format!("{} 没有固定文件制品", resource.id))
            })?;
            let (size, sha256) = resource_download::file_digest(path)?;
            if size != artifact.size || !sha256.eq_ignore_ascii_case(&artifact.sha256) {
                return Err(ResourceMigrationError::Integrity(format!(
                    "{} 的大小或 SHA-256 不匹配",
                    resource.id
                )));
            }
            Ok(size)
        }
        CandidatePayload::Directory {
            path,
            expected_manifest,
            included_files,
        } => {
            if let Some(included_files) = included_files {
                resource_download::run_health_check(resource, path)?;
                let mut bytes = 0_u64;
                for relative in included_files {
                    let file = resource_download::join_safe_relative(path, relative)?;
                    bytes = bytes.saturating_add(resource_download::file_digest(&file)?.0);
                }
                if bytes != resource.installed_size.unwrap_or(0) {
                    return Err(ResourceMigrationError::Integrity(format!(
                        "{} 的固定运行时文件大小不匹配",
                        resource.id
                    )));
                }
                return Ok(bytes);
            }
            let files = resource_download::verify_installed_payload(
                resource,
                path,
                expected_manifest.as_deref(),
            )?;
            Ok(files.iter().map(|file| file.size).sum())
        }
    }
}

fn adopt_candidate(
    root: &Path,
    candidate: &VerifiedCandidate,
) -> Result<(), ResourceMigrationError> {
    let resource = local_resources::resource_definition(&candidate.public.resource_id)?;
    let staging_root = root
        .join("staging")
        .join(format!("adopt-{}", Uuid::new_v4()));
    let staged_payload = staging_root.join("payload");
    fs::create_dir_all(&staged_payload)?;
    let copy_result = match &candidate.payload {
        CandidatePayload::File(path) => {
            let entrypoints = resource_download::effective_entrypoints(&resource)?;
            let relative = entrypoints.values().next().ok_or_else(|| {
                ResourceMigrationError::Integrity(format!("{} 没有文件入口", resource.id))
            })?;
            let destination = resource_download::join_safe_relative(&staged_payload, relative)?;
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(path, &destination)?;
            File::options().write(true).open(destination)?.sync_all()
        }
        CandidatePayload::Directory {
            path,
            included_files: Some(included_files),
            ..
        } => copy_selected_files(path, &staged_payload, included_files),
        CandidatePayload::Directory { path, .. } => copy_tree(path, &staged_payload),
    };
    if let Err(error) = copy_result {
        let _ = fs::remove_dir_all(&staging_root);
        return Err(error.into());
    }
    let expected_manifest = match &candidate.payload {
        CandidatePayload::Directory {
            expected_manifest, ..
        } => expected_manifest.as_deref(),
        CandidatePayload::File(_) => None,
    };
    let files = match resource_download::verify_installed_payload(
        &resource,
        &staged_payload,
        expected_manifest,
    ) {
        Ok(files) => files,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_root);
            return Err(error.into());
        }
    };
    if let Err(error) =
        resource_download::activate_staged_resource(root, &resource, &staged_payload, files)
    {
        let _ = fs::remove_dir_all(&staging_root);
        return Err(error.into());
    }
    let _ = fs::remove_dir_all(&staging_root);
    Ok(())
}

fn expected_file_name(resource: &crate::local_resources::ResourceDefinition) -> Option<String> {
    if resource.entrypoints.len() == 1 {
        return resource
            .entrypoints
            .values()
            .next()
            .and_then(|value| Path::new(value).file_name())
            .map(|value| value.to_string_lossy().into_owned());
    }
    let artifact = resource.artifact.as_ref()?;
    Url::parse(&artifact.url)
        .ok()?
        .path_segments()?
        .next_back()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[derive(Deserialize)]
struct RuntimeCandidateMetadata {
    files: Vec<RuntimeCandidateFile>,
}

#[derive(Deserialize)]
struct RuntimeCandidateFile {
    name: String,
}

fn runtime_included_files(directory: &Path) -> Result<Vec<String>, ResourceMigrationError> {
    let metadata_path = directory.join("runtime-metadata.json");
    let metadata = serde_json::from_slice::<RuntimeCandidateMetadata>(&fs::read(metadata_path)?)?;
    let mut files = metadata
        .files
        .into_iter()
        .map(|file| file.name)
        .collect::<Vec<_>>();
    files.push("runtime-metadata.json".to_owned());
    files.sort();
    files.dedup();
    if files.iter().any(|relative| {
        let path = Path::new(relative);
        path.components().count() != 1
            || !path
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
    }) {
        return Err(ResourceMigrationError::Integrity(
            "运行时元数据包含不安全的文件名".to_owned(),
        ));
    }
    Ok(files)
}

fn scan_source(root: &Path) -> Result<ScannedSource, ResourceMigrationError> {
    let mut scanned = ScannedSource::default();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0_usize)]);
    let mut entries = 0_usize;
    while let Some((directory, depth)) = queue.pop_front() {
        if depth > MAX_SCAN_DEPTH {
            continue;
        }
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            entries += 1;
            if entries > MAX_SCAN_ENTRIES {
                return Err(ResourceMigrationError::InvalidSource(format!(
                    "候选目录文件过多，已停止检查：{}",
                    root.display()
                )));
            }
            let path = entry.path();
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if matches!(
                    name.as_str(),
                    ".git"
                        | "node_modules"
                        | "target"
                        | "downloads"
                        | "staging"
                        | "leases"
                        | "database"
                        | "databases"
                ) {
                    continue;
                }
                queue.push_back((path, depth + 1));
            } else if file_type.is_file() && !is_database_file(&path) {
                scanned.files.push(path);
            }
        }
    }
    scanned.files.sort();
    Ok(scanned)
}

fn is_database_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "db" | "sqlite" | "sqlite3" | "wal" | "shm"
            )
        })
}

#[derive(Clone, Copy)]
enum MoveFault {
    None,
    #[cfg(test)]
    InterruptAfterCopy,
    #[cfg(test)]
    CorruptAfterCopy,
}

#[derive(Clone, Copy)]
struct MoveCopyOptions {
    available_bytes: Option<u64>,
    cross_volume: bool,
    fault: MoveFault,
}

struct VerifiedCopy {
    bytes: u64,
    files: usize,
    cross_volume: bool,
}

#[cfg(test)]
fn copy_root_verified(
    source: &Path,
    staging: &Path,
    options: MoveCopyOptions,
) -> Result<VerifiedCopy, ResourceMigrationError> {
    copy_root_verified_inner(source, staging, options, false)
}

fn copy_root_verified_inner(
    source: &Path,
    staging: &Path,
    options: MoveCopyOptions,
    resume_owned_staging: bool,
) -> Result<VerifiedCopy, ResourceMigrationError> {
    if staging.exists() && !resume_owned_staging {
        return Err(ResourceMigrationError::DestinationExists(path_string(
            staging,
        )));
    }
    let source_manifest = move_io::manifest(source)?;
    let bytes = source_manifest
        .iter()
        .fold(0_u64, |total, file| total.saturating_add(file.size));
    let remaining = if resume_owned_staging { move_io::remaining_bytes(source, staging, &source_manifest)? } else { bytes };
    let required = remaining.saturating_add(MOVE_MARGIN_BYTES);
    if let Some(available) = options.available_bytes
        && available < required
    {
        return Err(ResourceMigrationError::InsufficientSpace {
            required_bytes: required,
            available_bytes: available,
        });
    }
    if let Err(error) = move_io::copy_tree(source, staging) {
        let _ = fs::remove_dir_all(staging);
        return Err(error);
    }
    #[cfg(test)]
    match options.fault {
        MoveFault::InterruptAfterCopy => {
            let _ = fs::remove_dir_all(staging);
            return Err(ResourceMigrationError::Integrity("模拟复制中断".to_owned()));
        }
        MoveFault::CorruptAfterCopy => {
            let first = source_manifest
                .first()
                .ok_or_else(|| ResourceMigrationError::Integrity("测试目录没有文件".to_owned()))?;
            File::options()
                .append(true)
                .open(staging.join(&first.relative_path))?
                .write_all(b"corrupt")?;
        }
        MoveFault::None => {}
    }
    #[cfg(not(test))]
    let _ = options.fault;
    let target_manifest = match move_io::manifest(staging) {
        Ok(manifest) => manifest,
        Err(error) => { let _ = fs::remove_dir_all(staging); return Err(error); }
    };
    if source_manifest != target_manifest {
        let _ = fs::remove_dir_all(staging);
        return Err(ResourceMigrationError::Integrity(
            "复制后的文件数量、大小或 SHA-256 不一致".to_owned(),
        ));
    }
    Ok(VerifiedCopy {
        bytes,
        files: source_manifest.len(),
        cross_volume: options.cross_volume,
    })
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            return Err(io::Error::other(format!(
                "资源目录包含符号链接：{}",
                source_path.display()
            )));
        }
        if file_type.is_dir() {
            copy_tree(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path)?;
            File::options().write(true).open(&target_path)?.sync_all()?;
        }
    }
    Ok(())
}

fn copy_selected_files(
    source: &Path,
    destination: &Path,
    included_files: &[String],
) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for relative in included_files {
        let source_path = source.join(relative);
        let target_path = destination.join(relative);
        if !source_path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("候选资源缺少 {}", source_path.display()),
            ));
        }
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&source_path, &target_path)?;
        File::options().write(true).open(&target_path)?.sync_all()?;
    }
    Ok(())
}

fn volume_key(path: &Path) -> String {
    path.components()
        .find_map(|component| match component {
            Component::Prefix(prefix) => {
                Some(prefix.as_os_str().to_string_lossy().to_ascii_lowercase())
            }
            Component::RootDir => Some("/".to_owned()),
            _ => None,
        })
        .unwrap_or_default()
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    path_string(left).eq_ignore_ascii_case(&path_string(right))
}

fn push_unique_string(paths: &mut Vec<String>, path: &Path) {
    let value = path_string(path);
    if !paths.iter().any(|item| item.eq_ignore_ascii_case(&value)) {
        paths.push(value);
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    fn fixture_resource(
        id: &str,
        file_name: &str,
        contents: &[u8],
    ) -> crate::local_resources::ResourceDefinition {
        let sha256 = format!("{:x}", Sha256::digest(contents));
        crate::local_resources::ResourceDefinition {
            id: id.to_owned(),
            version: "1.0".to_owned(),
            platform: "any".to_owned(),
            kind: "model".to_owned(),
            bundled: false,
            installed_size: Some(contents.len() as u64),
            expected_download_size: Some(contents.len() as u64),
            license: "test".to_owned(),
            source_page: "https://example.com".to_owned(),
            artifact: Some(crate::local_resources::ResourceArtifact {
                url: format!("https://example.com/{file_name}"),
                size: contents.len() as u64,
                sha256,
                format: "file".to_owned(),
                strip_components: None,
            }),
            entrypoints: BTreeMap::new(),
            health_check: "sha256".to_owned(),
            source_commit: None,
            patch_sha256: None,
            requires: None,
            distribution: None,
        }
    }

    #[test]
    fn selected_directory_scan_reads_only_candidate_files_and_skips_database_and_leases() {
        let source = tempdir().expect("selected source directory");
        fs::write(source.path().join("unrelated.sqlite"), b"database").expect("db fixture");
        fs::create_dir_all(source.path().join("leases")).expect("lease directory");
        fs::write(source.path().join("leases/ggml-base.bin"), b"lease").expect("lease fixture");
        fs::create_dir_all(source.path().join("packages/model/1.0")).expect("candidate directory");
        let candidate = source.path().join("packages/model/1.0/fixture.bin");
        fs::write(&candidate, b"verified-model").expect("candidate fixture");
        let scanned = scan_source(source.path()).expect("source should scan");
        assert_eq!(scanned.files, vec![candidate.clone()]);
        let resource = fixture_resource("fixture-model", "fixture.bin", b"verified-model");
        assert_eq!(
            verify_candidate_payload(&resource, &CandidatePayload::File(candidate))
                .expect("candidate should verify"),
            14
        );
    }

    #[test]
    fn migration_sources_require_an_explicit_selected_directory() {
        assert!(
            candidate_sources(None, None)
                .expect("an omitted source should be accepted as empty")
                .is_empty()
        );
        let source = tempdir().expect("selected source directory");
        let source_path = source.path().to_string_lossy();
        let accepted = candidate_sources(Some(&source_path), Some("selected_directory"))
            .expect("the selected directory should be accepted");
        assert_eq!(accepted.len(), 1);
        assert_eq!(accepted[0].kind, "selected_directory");
        assert!(matches!(
            candidate_sources(Some(&source_path), Some("component_store")),
            Err(ResourceMigrationError::InvalidSource(_))
        ));
    }

    #[test]
    fn file_candidate_rejects_hash_mismatch() {
        let source = tempdir().expect("source");
        let candidate = source.path().join("fixture.bin");
        fs::write(&candidate, b"tampered").expect("candidate fixture");
        let resource = fixture_resource("fixture-model", "fixture.bin", b"trusted");
        assert!(matches!(
            verify_candidate_payload(&resource, &CandidatePayload::File(candidate)),
            Err(ResourceMigrationError::Integrity(_))
        ));
    }

    #[test]
    fn move_copy_verifies_same_volume_and_preserves_external_database_and_media() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("source");
        let staging = fixture.path().join("staging");
        fs::create_dir_all(source.join("packages/demo/1.0")).expect("source directory");
        fs::write(source.join("packages/demo/1.0/tool.exe"), b"runtime").expect("runtime");
        let database = fixture.path().join("siaovplay.db");
        let media = fixture.path().join("movie.mp4");
        fs::write(&database, b"project-database").expect("database");
        fs::write(&media, b"media-content").expect("media");
        let database_before = resource_download::file_digest(&database).expect("database hash");
        let media_before = resource_download::file_digest(&media).expect("media hash");
        let verified = copy_root_verified(
            &source,
            &staging,
            MoveCopyOptions {
                available_bytes: Some(u64::MAX),
                cross_volume: false,
                fault: MoveFault::None,
            },
        )
        .expect("copy should verify");
        assert_eq!(verified.files, 1);
        assert!(!verified.cross_volume);
        assert_eq!(
            database_before,
            resource_download::file_digest(&database).expect("database hash")
        );
        assert_eq!(
            media_before,
            resource_download::file_digest(&media).expect("media hash")
        );
        assert!(source.is_dir(), "the active source remains available");
        let cross_volume_staging = fixture.path().join("cross-volume-staging");
        let cross_volume = copy_root_verified(
            &source,
            &cross_volume_staging,
            MoveCopyOptions {
                available_bytes: Some(u64::MAX),
                cross_volume: true,
                fault: MoveFault::None,
            },
        )
        .expect("cross-volume copy should use the same verified protocol");
        assert!(cross_volume.cross_volume);
        assert_eq!(cross_volume.files, verified.files);
    }

    #[test]
    fn move_copy_failure_matrix_keeps_original_source_available() {
        for fault in [MoveFault::InterruptAfterCopy, MoveFault::CorruptAfterCopy] {
            let fixture = tempdir().expect("fixture");
            let source = fixture.path().join("source");
            let staging = fixture.path().join("cross-volume-staging");
            fs::create_dir_all(&source).expect("source directory");
            fs::write(source.join("resource.bin"), b"trusted-runtime").expect("source file");
            assert!(
                copy_root_verified(
                    &source,
                    &staging,
                    MoveCopyOptions {
                        available_bytes: Some(u64::MAX),
                        cross_volume: true,
                        fault,
                    },
                )
                .is_err()
            );
            assert_eq!(
                fs::read(source.join("resource.bin")).expect("source remains"),
                b"trusted-runtime"
            );
            assert!(!staging.exists());
        }
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("source");
        let staging = fixture.path().join("low-space-staging");
        fs::create_dir_all(&source).expect("source directory");
        fs::write(source.join("resource.bin"), b"trusted-runtime").expect("source file");
        assert!(matches!(
            copy_root_verified(
                &source,
                &staging,
                MoveCopyOptions {
                    available_bytes: Some(1),
                    cross_volume: true,
                    fault: MoveFault::None,
                },
            ),
            Err(ResourceMigrationError::InsufficientSpace { .. })
        ));
        assert!(source.join("resource.bin").is_file());
    }

    #[test]
    #[ignore = "requires explicitly selected W: runtime and model directories"]
    fn real_selected_resources_match_the_current_catalog_without_downloads() {
        let runtime_root = std::env::var_os("SIAOVPLAY_PHASE6_LEGACY_RUNTIME_ROOT")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_PHASE6_LEGACY_RUNTIME_ROOT is required");
        let model_root = std::env::var_os("SIAOVPLAY_PHASE6_LEGACY_MODEL_ROOT")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_PHASE6_LEGACY_MODEL_ROOT is required");
        let sources = vec![
            CandidateSource {
                kind: "selected_directory".to_owned(),
                root: runtime_root,
            },
            CandidateSource {
                kind: "selected_directory".to_owned(),
                root: model_root,
            },
        ];
        let (verified, rejected) = inspect_sources(&sources).expect("real sources should inspect");
        let verified_ids = verified
            .iter()
            .map(|candidate| candidate.public.resource_id.clone())
            .collect::<BTreeSet<_>>();
        for expected in [
            "yt-dlp",
            "whisper-cpu",
            "whisper-vulkan",
            "whisper-vad-silero-6.2",
            "whisper-model-base",
            "whisper-model-small",
        ] {
            assert!(
                verified_ids.contains(expected),
                "{expected} should be reusable without downloading"
            );
        }
        assert!(
            !verified_ids.contains("ffmpeg-cpu"),
            "an extracted FFmpeg directory without a current receipt must not be trusted"
        );
        if let Some(evidence_path) =
            std::env::var_os("SIAOVPLAY_PHASE6_MIGRATION_EVIDENCE").map(PathBuf::from)
        {
            if let Some(parent) = evidence_path.parent() {
                fs::create_dir_all(parent).expect("evidence directory should create");
            }
            fs::write(
                evidence_path,
                serde_json::to_vec_pretty(&serde_json::json!({
                    "verifiedResourceIds": verified_ids,
                    "rejectedCandidates": rejected,
                    "componentStoreDatabaseRead": false,
                    "componentStoreLeaseRead": false,
                    "downloadRequiredForVerifiedCandidates": false
                }))
                .expect("evidence should serialize"),
            )
            .expect("evidence should write");
        }
    }
}
