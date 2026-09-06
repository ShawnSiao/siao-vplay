mod maintenance;
pub use maintenance::{rollback_resource, cleanup_old_versions};

use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use url::Url;
use uuid::Uuid;

use crate::{
    local_resources::{self, LocalResourceError, ResourceDefinition, ResourceReceipt},
    resource_download::{self, ResourceDownloadError},
};

const CATALOG_SOURCE: &str = "embedded";
const REMOTE_CATALOG_ENABLED: bool = false;
const REMOTE_SIGNATURE_POLICY: &str = "ed25519-detached-v1-required-before-enable";
const THIRD_PARTY_NOTICES: &str =
    include_str!("../resources/third-party-notices/THIRD-PARTY-NOTICES.md");

#[derive(Debug, Error)]
pub enum ResourceDiagnosticsError {
    #[error(transparent)]
    LocalResource(#[from] LocalResourceError),
    #[error(transparent)]
    Download(#[from] ResourceDownloadError),
    #[error("资源诊断文件操作失败：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("资源诊断数据无效：{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("执行此版本操作前需要明确确认")]
    ConfirmationRequired,
    #[error("资源正在准备，当前不能切换或清理版本：{0}")]
    Busy(String),
    #[error("未找到已验证资源版本：{0}@{1}")]
    VersionNotFound(String, String),
    #[error("不能删除活动资源版本：{0}@{1}")]
    ActiveVersionProtected(String, String),
}

impl ResourceDiagnosticsError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::LocalResource(LocalResourceError::RootUnavailable(_)) => "root_unavailable",
            Self::LocalResource(_) => "local_resource_error",
            Self::Download(error) => error.code(),
            Self::FileSystem(_) => "local_resource_filesystem_error",
            Self::Serialization(_) => "local_resource_serialization_error",
            Self::ConfirmationRequired => "local_resource_confirmation_required",
            Self::Busy(_) => "local_resource_busy",
            Self::VersionNotFound(_, _) => "local_resource_version_not_found",
            Self::ActiveVersionProtected(_, _) => "local_resource_active_version_protected",
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceDiagnostics {
    pub generated_at_ms: i64,
    pub catalog_source: String,
    pub remote_catalog_enabled: bool,
    pub remote_signature_policy: String,
    pub root_state: String,
    pub resource_root: Option<String>,
    pub preferred_profile: String,
    pub resources: Vec<ResourceDiagnosticItem>,
    pub tasks: Vec<ResourceTaskDiagnostic>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDiagnosticItem {
    pub id: String,
    pub catalog_version: String,
    pub active_version: Option<String>,
    pub state: String,
    pub license: String,
    pub source_page: String,
    pub artifact_sha256: Option<String>,
    pub artifact_url: Option<String>,
    pub health_check: String,
    pub versions: Vec<ResourceVersionDiagnostic>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceVersionDiagnostic {
    pub version: String,
    pub active: bool,
    pub install_path: String,
    pub file_count: usize,
    pub installed_bytes: u64,
    pub manifest_sha256: String,
    pub health_status: String,
    pub activated_at_ms: Option<i64>,
    pub entrypoints_available: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceTaskDiagnostic {
    pub id: String,
    pub resource_id: String,
    pub version: String,
    pub state: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackLocalResourceInput {
    pub resource_id: String,
    pub version: String,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRollbackResult {
    pub resource_id: String,
    pub previous_version: String,
    pub active_version: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupOldResourceVersionsInput {
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OldResourceVersionCandidate {
    pub resource_id: String,
    pub version: String,
    pub reclaimable_bytes: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OldResourceVersionCleanupPlan {
    pub candidates: Vec<OldResourceVersionCandidate>,
    pub protected_versions: Vec<String>,
    pub reclaimable_bytes: u64,
    pub confirmation_required: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OldResourceVersionCleanupResult {
    pub removed_versions: Vec<String>,
    pub reclaimed_bytes: u64,
}

pub fn diagnostics() -> Result<LocalResourceDiagnostics, ResourceDiagnosticsError> {
    let status = local_resources::status()?;
    let configuration = local_resources::configuration_snapshot();
    let root = configuration
        .as_ref()
        .map(|configuration| PathBuf::from(&configuration.resource_root));
    let mut resources = Vec::new();
    for resource in &local_resources::catalog()?.resources {
        let active_version = configuration
            .as_ref()
            .and_then(|configuration| configuration.active_resources.get(&resource.id))
            .cloned();
        let receipts = local_resources::installed_receipts(&resource.id)?;
        let versions = receipts
            .iter()
            .map(|receipt| version_diagnostic(root.as_deref(), receipt, active_version.as_deref()))
            .collect::<Result<Vec<_>, _>>()?;
        let state = if active_version.is_none() {
            "not_installed"
        } else if local_resources::resource_update_available(&resource.id)? {
            "update_available"
        } else if local_resources::resource_is_ready(&resource.id)? {
            "ready"
        } else {
            "repair_required"
        };
        resources.push(ResourceDiagnosticItem {
            id: resource.id.clone(),
            catalog_version: resource.version.clone(),
            active_version,
            state: state.to_owned(),
            license: resource.license.clone(),
            source_page: redact_url(&resource.source_page),
            artifact_sha256: resource
                .artifact
                .as_ref()
                .map(|artifact| artifact.sha256.clone()),
            artifact_url: resource
                .artifact
                .as_ref()
                .map(|artifact| redact_url(&artifact.url)),
            health_check: resource.health_check.clone(),
            versions,
        });
    }
    let resource_root = status.resource_root.clone();
    let tasks = resource_download::list_tasks()?
        .into_iter()
        .map(|task| ResourceTaskDiagnostic {
            id: task.id,
            resource_id: task.resource_id,
            version: task.version,
            state: format!("{:?}", task.state).to_ascii_lowercase(),
            downloaded_bytes: task.downloaded_bytes,
            total_bytes: task.total_bytes,
            error_code: task.error_code,
            error_message: task
                .error_message
                .map(|message| redact_sensitive_text(&message, resource_root.as_deref())),
        })
        .collect();
    Ok(LocalResourceDiagnostics {
        generated_at_ms: now_ms(),
        catalog_source: CATALOG_SOURCE.to_owned(),
        remote_catalog_enabled: REMOTE_CATALOG_ENABLED,
        remote_signature_policy: REMOTE_SIGNATURE_POLICY.to_owned(),
        root_state: match status.root_state {
            crate::local_resources::LocalResourceRootState::SetupRequired => "setup_required",
            crate::local_resources::LocalResourceRootState::Ready => "ready",
            crate::local_resources::LocalResourceRootState::RootUnavailable => "root_unavailable",
            crate::local_resources::LocalResourceRootState::RepairRequired => "repair_required",
        }
        .to_owned(),
        resource_root,
        preferred_profile: status.preferred_profile,
        resources,
        tasks,
    })
}

pub fn diagnostic_summary() -> Result<String, ResourceDiagnosticsError> {
    let diagnostics = diagnostics()?;
    let mut lines = vec![
        "SiaoVPlay 本地资源诊断摘要".to_owned(),
        format!("生成时间：{}", diagnostics.generated_at_ms),
        format!(
            "目录清单：{}；远程目录：{}；签名策略：{}",
            diagnostics.catalog_source,
            if diagnostics.remote_catalog_enabled {
                "启用"
            } else {
                "未启用"
            },
            diagnostics.remote_signature_policy
        ),
        format!("资源位置状态：{}", diagnostics.root_state),
        format!("字幕识别方式：{}", diagnostics.preferred_profile),
    ];
    for resource in diagnostics.resources {
        lines.push(format!(
            "资源 {}：状态 {}；当前版本 {}；目录版本 {}；已安装版本 {}",
            resource.id,
            resource.state,
            resource.active_version.as_deref().unwrap_or("无"),
            resource.catalog_version,
            resource.versions.len()
        ));
    }
    for task in diagnostics.tasks {
        if let Some(message) = task.error_message {
            lines.push(format!(
                "任务 {} {}：{} {}",
                task.resource_id,
                task.state,
                task.error_code.as_deref().unwrap_or("未分类"),
                message
            ));
        }
    }
    Ok(lines.join("\n"))
}

pub fn third_party_notices() -> &'static str {
    THIRD_PARTY_NOTICES
}


pub fn plan_old_version_cleanup() -> Result<OldResourceVersionCleanupPlan, ResourceDiagnosticsError>
{
    let configuration = local_resources::configuration_snapshot()
        .ok_or(LocalResourceError::ConfirmationRequired)?;
    let mut candidates = Vec::new();
    let mut protected_versions = Vec::new();
    for resource in &local_resources::catalog()?.resources {
        let active = configuration.active_resources.get(&resource.id);
        let receipts = local_resources::installed_receipts(&resource.id)?;
        let (cleanup, protected) = select_cleanup_versions(&resource.id, &receipts, active, 1);
        candidates.extend(cleanup);
        protected_versions.extend(protected);
    }
    candidates.sort_by(|left, right| {
        left.resource_id
            .cmp(&right.resource_id)
            .then(left.version.cmp(&right.version))
    });
    protected_versions.sort();
    protected_versions.dedup();
    let reclaimable_bytes = candidates.iter().fold(0_u64, |total, candidate| {
        total.saturating_add(candidate.reclaimable_bytes)
    });
    Ok(OldResourceVersionCleanupPlan {
        candidates,
        protected_versions,
        reclaimable_bytes,
        confirmation_required: true,
    })
}


fn select_cleanup_versions(
    resource_id: &str,
    receipts: &[ResourceReceipt],
    active_version: Option<&String>,
    keep_previous: usize,
) -> (Vec<OldResourceVersionCandidate>, Vec<String>) {
    let mut inactive = receipts
        .iter()
        .filter(|receipt| active_version.is_none_or(|active| active != &receipt.version))
        .collect::<Vec<_>>();
    inactive.sort_by(|left, right| {
        right
            .activated_at_ms
            .unwrap_or_default()
            .cmp(&left.activated_at_ms.unwrap_or_default())
            .then(right.version.cmp(&left.version))
    });
    let mut protected = active_version
        .map(|version| vec![format!("{resource_id}@{version}")])
        .unwrap_or_default();
    protected.extend(
        inactive
            .iter()
            .take(keep_previous)
            .map(|receipt| format!("{resource_id}@{}", receipt.version)),
    );
    let cleanup = inactive
        .into_iter()
        .skip(keep_previous)
        .map(|receipt| OldResourceVersionCandidate {
            resource_id: resource_id.to_owned(),
            version: receipt.version.clone(),
            reclaimable_bytes: receipt
                .files
                .iter()
                .fold(0_u64, |total, file| total.saturating_add(file.size)),
        })
        .collect();
    (cleanup, protected)
}

fn verify_historic_receipt(
    root: &str,
    receipt: &ResourceReceipt,
) -> Result<(), ResourceDiagnosticsError> {
    let current = local_resources::resource_definition(&receipt.resource_id)?;
    let mut historic = historic_definition(&current, receipt);
    let payload =
        resource_download::join_safe_relative(Path::new(root), &receipt.install_relative_path)?;
    historic.installed_size = Some(
        receipt
            .files
            .iter()
            .fold(0_u64, |total, file| total.saturating_add(file.size)),
    );
    resource_download::verify_installed_payload(&historic, &payload, Some(&receipt.files))?;
    Ok(())
}

fn historic_definition(
    current: &ResourceDefinition,
    receipt: &ResourceReceipt,
) -> ResourceDefinition {
    let mut historic = current.clone();
    historic.version = receipt.version.clone();
    historic.kind = "archive".to_owned();
    historic.artifact = None;
    historic.entrypoints = receipt.entrypoints.clone();
    historic
}

fn version_diagnostic(
    root: Option<&Path>,
    receipt: &ResourceReceipt,
    active_version: Option<&str>,
) -> Result<ResourceVersionDiagnostic, ResourceDiagnosticsError> {
    let install = root
        .map(|root| resource_download::join_safe_relative(root, &receipt.install_relative_path))
        .transpose()?
        .unwrap_or_else(|| PathBuf::from(&receipt.install_relative_path));
    let entrypoints_available = receipt.entrypoints.values().all(|entrypoint| {
        resource_download::join_safe_relative(&install, entrypoint).is_ok_and(|path| path.is_file())
    });
    Ok(ResourceVersionDiagnostic {
        version: receipt.version.clone(),
        active: active_version == Some(receipt.version.as_str()),
        install_path: install.to_string_lossy().into_owned(),
        file_count: receipt.files.len(),
        installed_bytes: receipt
            .files
            .iter()
            .fold(0_u64, |total, file| total.saturating_add(file.size)),
        manifest_sha256: receipt_manifest_sha256(receipt),
        health_status: receipt.health_status.clone(),
        activated_at_ms: receipt.activated_at_ms,
        entrypoints_available,
    })
}

fn receipt_manifest_sha256(receipt: &ResourceReceipt) -> String {
    let mut files = receipt.files.clone();
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let mut hasher = Sha256::new();
    for file in files {
        hasher.update(file.relative_path.as_bytes());
        hasher.update([0]);
        hasher.update(file.size.to_le_bytes());
        hasher.update(file.sha256.as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

fn redact_url(value: &str) -> String {
    let Ok(mut url) = Url::parse(value) else {
        return value.to_owned();
    };
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

fn redact_sensitive_text(value: &str, resource_root: Option<&str>) -> String {
    static QUERY: OnceLock<Regex> = OnceLock::new();
    static CREDENTIAL: OnceLock<Regex> = OnceLock::new();
    static USER_HOME: OnceLock<Regex> = OnceLock::new();
    let query = QUERY.get_or_init(|| {
        Regex::new(r"(?i)(https://[^\s?]+)\?[^\s]+")
            .expect("diagnostic URL redaction regex should compile")
    });
    let credential = CREDENTIAL.get_or_init(|| {
        Regex::new(r"(?i)(token|api[_-]?key|secret|password)=([^\s&]+)")
            .expect("diagnostic credential redaction regex should compile")
    });
    let user_home = USER_HOME.get_or_init(|| {
        Regex::new(r"(?i)[a-z]:\\Users\\[^\\\s]+")
            .expect("diagnostic user-home redaction regex should compile")
    });
    let mut redacted = value.to_owned();
    if let Some(root) = resource_root {
        if let Ok(root_pattern) = Regex::new(&format!("(?i){}", regex::escape(root))) {
            redacted = root_pattern
                .replace_all(&redacted, "<resource-root>")
                .into_owned();
        }
    }
    redacted = query.replace_all(&redacted, "$1?<redacted>").into_owned();
    redacted = credential
        .replace_all(&redacted, "$1=<redacted>")
        .into_owned();
    user_home.replace_all(&redacted, "<user-home>").into_owned()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_resources::{ReceiptFile, ResourceArtifact};

    fn receipt(version: &str, activated_at_ms: i64, bytes: u64) -> ResourceReceipt {
        ResourceReceipt {
            schema_version: 1,
            resource_id: "demo".to_owned(),
            version: version.to_owned(),
            install_relative_path: format!("packages/demo/{version}"),
            entrypoints: std::collections::BTreeMap::from([(
                "tool".to_owned(),
                "tool.exe".to_owned(),
            )]),
            files: vec![ReceiptFile {
                relative_path: "tool.exe".to_owned(),
                size: bytes,
                sha256: "a".repeat(64),
            }],
            health_status: "passed".to_owned(),
            activated_at_ms: Some(activated_at_ms),
        }
    }

    #[test]
    fn cleanup_protects_active_and_one_previous_verified_version() {
        let receipts = vec![
            receipt("3.0", 300, 30),
            receipt("2.0", 200, 20),
            receipt("1.0", 100, 10),
        ];
        let active = "3.0".to_owned();
        let (cleanup, protected) = select_cleanup_versions("demo", &receipts, Some(&active), 1);
        assert_eq!(protected, vec!["demo@3.0", "demo@2.0"]);
        assert_eq!(cleanup.len(), 1);
        assert_eq!(cleanup[0].version, "1.0");
        assert_eq!(cleanup[0].reclaimable_bytes, 10);
    }

    #[test]
    fn historic_definition_uses_receipt_version_manifest_and_entrypoints() {
        let current = ResourceDefinition {
            id: "demo".to_owned(),
            version: "3.0".to_owned(),
            platform: "windows-x86_64".to_owned(),
            kind: "file".to_owned(),
            bundled: false,
            installed_size: Some(30),
            expected_download_size: Some(30),
            license: "test".to_owned(),
            source_page: "https://example.com".to_owned(),
            artifact: Some(ResourceArtifact {
                url: "https://example.com/tool.exe?token=secret".to_owned(),
                size: 30,
                sha256: "b".repeat(64),
                format: "file".to_owned(),
                strip_components: None,
            }),
            entrypoints: Default::default(),
            health_check: "sha256".to_owned(),
            source_commit: None,
            patch_sha256: None,
            requires: None,
            distribution: None,
        };
        let receipt = receipt("2.0", 200, 20);
        let historic = historic_definition(&current, &receipt);
        assert_eq!(historic.version, "2.0");
        assert_eq!(historic.kind, "archive");
        assert!(historic.artifact.is_none());
        assert_eq!(historic.entrypoints, receipt.entrypoints);
    }

    #[test]
    fn diagnostics_redact_queries_credentials_user_homes_and_resource_roots() {
        let text = "failed https://example.com/file?token=super-secret api_key=hidden C:\\Users\\Shawn\\media.mp4 w:\\private\\siaovplay\\downloads";
        let redacted = redact_sensitive_text(text, Some("W:\\Private\\SiaoVPlay"));
        assert!(!redacted.contains("super-secret"));
        assert!(!redacted.contains("hidden"));
        assert!(!redacted.contains("Shawn"));
        assert!(
            !redacted
                .to_ascii_lowercase()
                .contains("w:\\private\\siaovplay")
        );
        assert!(redacted.contains("?<redacted>"));
        assert!(redacted.contains("<user-home>"));
        assert!(redacted.contains("<resource-root>"));
        assert_eq!(
            redact_url("https://user:pass@example.com/file?token=secret#fragment"),
            "https://example.com/file"
        );
    }

    #[test]
    fn remote_catalog_remains_disabled_until_detached_signature_policy_exists() {
        assert_eq!(CATALOG_SOURCE, "embedded");
        assert!(!std::hint::black_box(REMOTE_CATALOG_ENABLED));
        assert_eq!(
            REMOTE_SIGNATURE_POLICY,
            "ed25519-detached-v1-required-before-enable"
        );
        assert!(THIRD_PARTY_NOTICES.contains("本安装包不包含"));
    }
}
