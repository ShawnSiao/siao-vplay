use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use reqwest::{
    Proxy,
    blocking::{Client, ClientBuilder},
};
use url::Url;

use super::{
    error::AiError,
    storage,
    types::{NetworkSettings, NetworkSettingsFile, SetNetworkSettingsInput},
};

const SETTINGS_FILE_NAME: &str = "network-settings.json";
const SETTINGS_SCHEMA_VERSION: u32 = 1;
static STORE: OnceLock<NetworkStore> = OnceLock::new();

pub struct NetworkStore {
    path: PathBuf,
    mutation_lock: Mutex<()>,
}

impl NetworkStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            mutation_lock: Mutex::new(()),
        }
    }

    fn load(&self) -> Result<NetworkSettingsFile, AiError> {
        let settings: NetworkSettingsFile = storage::read_json(&self.path)
            .map_err(|_| AiError::ConfigurationRead)?
            .unwrap_or(NetworkSettingsFile {
                schema_version: SETTINGS_SCHEMA_VERSION,
                revision: 0,
                custom_proxy_url: None,
            });
        if settings.schema_version != SETTINGS_SCHEMA_VERSION {
            return Err(AiError::ConfigurationRead);
        }
        Ok(settings)
    }

    fn persist(&self, settings: &NetworkSettingsFile) -> Result<(), AiError> {
        storage::write_json_atomic(&self.path, settings).map_err(|_| AiError::ConfigurationWrite)
    }

    pub fn migrate_legacy_proxy(&self, legacy_proxy: Option<&str>) -> Result<(), AiError> {
        if self.path.exists() {
            return Ok(());
        }
        let normalized = normalize_proxy_url(legacy_proxy)?;
        if normalized.is_none() {
            return Ok(());
        }
        self.persist(&NetworkSettingsFile {
            schema_version: SETTINGS_SCHEMA_VERSION,
            revision: 1,
            custom_proxy_url: normalized,
        })
    }

    pub fn snapshot(&self) -> Result<NetworkSettings, AiError> {
        let settings = self.load()?;
        let (proxy_address, source) = effective_proxy_from(settings.custom_proxy_url.clone());
        Ok(NetworkSettings {
            schema_version: settings.schema_version,
            revision: settings.revision,
            custom_proxy_url: settings.custom_proxy_url,
            effective_mode: if proxy_address.is_some() || source == "environment" {
                "proxy".to_owned()
            } else {
                "direct".to_owned()
            },
            effective_source: source.to_owned(),
            effective_proxy_address: proxy_address,
        })
    }

    pub fn set(&self, input: SetNetworkSettingsInput) -> Result<NetworkSettings, AiError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| AiError::ConfigurationWrite)?;
        let mut settings = self.load()?;
        if settings.revision != input.expected_revision {
            return Err(AiError::RevisionConflict);
        }
        settings.custom_proxy_url = normalize_proxy_url(input.custom_proxy_url.as_deref())?;
        settings.revision += 1;
        self.persist(&settings)?;
        drop(_guard);
        self.snapshot()
    }

    pub fn set_compat(&self, proxy_url: Option<&str>) -> Result<NetworkSettings, AiError> {
        let revision = self.load()?.revision;
        self.set(SetNetworkSettingsInput {
            expected_revision: revision,
            custom_proxy_url: proxy_url.map(str::to_owned),
        })
    }
}

pub fn initialize(data_directory: &Path, legacy_proxy: Option<&str>) -> Result<(), AiError> {
    let store = NetworkStore::new(data_directory.join(SETTINGS_FILE_NAME));
    store.migrate_legacy_proxy(legacy_proxy)?;
    let _ = store.snapshot()?;
    STORE
        .set(store)
        .map_err(|_| AiError::Validation("网络设置已经初始化".to_owned()))
}

fn store() -> Result<&'static NetworkStore, AiError> {
    STORE.get().ok_or(AiError::NotInitialized)
}

pub fn settings() -> Result<NetworkSettings, AiError> {
    store()?.snapshot()
}

pub fn set_settings(input: SetNetworkSettingsInput) -> Result<NetworkSettings, AiError> {
    store()?.set(input)
}

pub fn set_custom_proxy_compat(proxy_url: Option<&str>) -> Result<NetworkSettings, AiError> {
    store()?.set_compat(proxy_url)
}

pub fn effective_proxy() -> (Option<String>, &'static str) {
    let custom = store()
        .and_then(NetworkStore::load)
        .ok()
        .and_then(|settings| settings.custom_proxy_url);
    effective_proxy_from(custom)
}

pub fn apply_to_client(builder: ClientBuilder) -> Result<ClientBuilder, String> {
    let (proxy_url, source) = effective_proxy();
    if let Some(proxy_url) = proxy_url {
        let proxy = Proxy::all(&proxy_url).map_err(|_| "代理地址无效".to_owned())?;
        Ok(builder.proxy(proxy))
    } else if source == "environment" {
        Ok(builder)
    } else {
        Ok(builder.no_proxy())
    }
}

pub fn build_client(builder: ClientBuilder) -> Result<Client, String> {
    apply_to_client(builder)?
        .build()
        .map_err(|_| "无法创建网络连接".to_owned())
}

fn effective_proxy_from(custom: Option<String>) -> (Option<String>, &'static str) {
    if let Some(proxy) = custom {
        return (Some(proxy), "custom");
    }
    if environment_proxy_configured() {
        return (None, "environment");
    }
    if let Some(proxy) = windows_system_proxy() {
        return (Some(proxy), "windows_system");
    }
    (None, "direct")
}

fn normalize_proxy_url(proxy_url: Option<&str>) -> Result<Option<String>, AiError> {
    let Some(proxy_url) = proxy_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let parsed = Url::parse(proxy_url)
        .map_err(|_| AiError::Validation("请输入完整的 HTTP(S) 代理地址".to_owned()))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(AiError::Validation(
            "代理地址不能包含账号、密码或查询参数".to_owned(),
        ));
    }
    Ok(Some(parsed.to_string().trim_end_matches('/').to_owned()))
}

fn environment_proxy_configured() -> bool {
    [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ]
    .iter()
    .any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty()))
}

#[cfg(windows)]
fn windows_system_proxy() -> Option<String> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};

    let settings = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    if settings.get_value::<u32, _>("ProxyEnable").ok()? == 0 {
        return None;
    }
    parse_windows_proxy_server(&settings.get_value::<String, _>("ProxyServer").ok()?)
}

#[cfg(not(windows))]
fn windows_system_proxy() -> Option<String> {
    None
}

fn parse_windows_proxy_server(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let candidate = if raw.contains('=') {
        let entries = raw
            .split(';')
            .filter_map(|entry| entry.split_once('='))
            .map(|(scheme, address)| (scheme.trim().to_ascii_lowercase(), address.trim()))
            .collect::<Vec<_>>();
        entries
            .iter()
            .find(|(scheme, _)| scheme == "https")
            .or_else(|| entries.iter().find(|(scheme, _)| scheme == "http"))
            .map(|(_, address)| *address)?
    } else {
        raw
    };
    let with_scheme = if candidate.contains("://") {
        candidate.to_owned()
    } else {
        format!("http://{candidate}")
    };
    normalize_proxy_url(Some(&with_scheme)).ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validates_proxy_and_migrates_legacy_setting_once() {
        let data = tempdir().expect("tempdir");
        let store = NetworkStore::new(data.path().join(SETTINGS_FILE_NAME));
        store
            .migrate_legacy_proxy(Some("http://127.0.0.1:7897"))
            .expect("migration");
        let snapshot = store.snapshot().expect("snapshot");
        assert_eq!(snapshot.revision, 1);
        assert_eq!(
            snapshot.custom_proxy_url.as_deref(),
            Some("http://127.0.0.1:7897")
        );
        assert!(normalize_proxy_url(Some("http://user:secret@proxy.example")).is_err());
    }

    #[test]
    fn windows_proxy_parser_prefers_https_and_normalizes_address() {
        assert_eq!(
            parse_windows_proxy_server("http=127.0.0.1:8080;https=127.0.0.1:7897"),
            Some("http://127.0.0.1:7897".to_owned())
        );
        assert_eq!(
            parse_windows_proxy_server("http://proxy.example:3128"),
            Some("http://proxy.example:3128".to_owned())
        );
        assert_eq!(parse_windows_proxy_server("socks=127.0.0.1:1080"), None);
    }
}
