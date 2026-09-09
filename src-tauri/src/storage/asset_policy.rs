use super::StorageError;
use serde::Deserialize;
use std::{collections::HashSet, sync::OnceLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy {
    schema_version: u32,
    preserve_unknown: bool,
    rules: Vec<Rule>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Rule {
    id: String,
    root: Root,
    path: Option<String>,
    class: Class,
    transfer: Transfer,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
enum Root {
    AppData,
    Bootstrap,
    RemoteMedia,
    MediaCache,
    ResourceRoot,
    ExternalMedia,
    ExportDirectory,
    CredentialStore,
}
#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Class {
    UserAsset,
    Preference,
    RecoveryWorkingData,
    RegenerableCache,
    RuntimeComponent,
    BrowserProfile,
    Credential,
}
#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Transfer {
    Copy,
    DatabaseBackup,
    RetainAtBootstrap,
    ManagedCopyOrRebuild,
    ExternalReference,
    ResourceMaintenance,
    CredentialReentry,
}

fn parse(json: &str) -> Result<Policy, String> {
    let policy: Policy = serde_json::from_str(json).map_err(|error| error.to_string())?;
    if policy.schema_version != 1 || !policy.preserve_unknown {
        return Err("存储策略版本或未知文件保留规则无效".into());
    }
    let mut ids = HashSet::new();
    let mut locations = HashSet::new();
    for rule in &policy.rules {
        if rule.id.is_empty()
            || !rule
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !ids.insert(&rule.id)
            || !locations.insert((rule.root, &rule.path))
        {
            return Err("存储策略标识或位置重复".into());
        }
        if let Some(path) = &rule.path {
            if path.contains(['\\', ':', '\0'])
                || path.split('/').any(|part| {
                    part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' '])
                })
            {
                return Err("存储策略路径必须为安全的相对路径".into());
            }
        }
        let valid = match rule.root {
            Root::AppData => {
                rule.path.is_some()
                    && match rule.class {
                        Class::UserAsset => {
                            matches!(rule.transfer, Transfer::Copy | Transfer::DatabaseBackup)
                        }
                        Class::Preference
                        | Class::RecoveryWorkingData
                        | Class::RegenerableCache => rule.transfer == Transfer::Copy,
                        _ => false,
                    }
            }
            Root::Bootstrap => {
                rule.class == Class::BrowserProfile
                    && rule.transfer == Transfer::RetainAtBootstrap
                    && rule.path.as_deref().is_some_and(|path| !path.contains('/'))
            }
            Root::RemoteMedia => {
                rule.path.is_none()
                    && rule.class == Class::UserAsset
                    && rule.transfer == Transfer::Copy
            }
            Root::MediaCache => {
                rule.path.is_none()
                    && rule.class == Class::RegenerableCache
                    && rule.transfer == Transfer::ManagedCopyOrRebuild
            }
            Root::ResourceRoot => {
                rule.path.is_none()
                    && rule.class == Class::RuntimeComponent
                    && rule.transfer == Transfer::ResourceMaintenance
            }
            Root::ExternalMedia | Root::ExportDirectory => {
                rule.path.is_none()
                    && rule.class == Class::UserAsset
                    && rule.transfer == Transfer::ExternalReference
            }
            Root::CredentialStore => {
                rule.path.is_none()
                    && rule.class == Class::Credential
                    && rule.transfer == Transfer::CredentialReentry
            }
        };
        if !valid {
            return Err("存储策略的数据类别与迁移方式冲突".into());
        }
    }
    if !policy.rules.iter().any(|rule| {
        rule.id == "webview-profile"
            && rule.root == Root::Bootstrap
            && rule.path.as_deref() == Some("EBWebView")
    }) {
        return Err("存储策略缺少已验证的浏览器数据保留边界".into());
    }
    Ok(policy)
}

// Classification never authorizes deletion. Cache cleanup must still prove file
// ownership from domain records, and unknown files remain untouched.
pub(super) fn bootstrap_retained_names() -> Result<Vec<&'static str>, StorageError> {
    static POLICY: OnceLock<Result<Policy, String>> = OnceLock::new();
    let policy = POLICY
        .get_or_init(|| parse(include_str!("asset-policy.json")))
        .as_ref()
        .map_err(|error| StorageError::MigrationIntegrity(error.clone()))?;
    Ok(policy
        .rules
        .iter()
        .filter(|rule| rule.root == Root::Bootstrap)
        .filter_map(|rule| rule.path.as_deref())
        .collect())
}

#[cfg(test)]
#[path = "asset_policy_tests.rs"]
mod tests;
