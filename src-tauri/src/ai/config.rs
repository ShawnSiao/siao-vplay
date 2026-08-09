use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

use super::{
    catalog,
    credentials::{CredentialStore, WindowsCredentialStore},
    error::AiError,
    storage,
    types::{
        AiProviderId, AiServiceCapabilities, AiServiceConfig, AiServiceSettings, AiServiceSummary,
        ConnectionState, CredentialState, DeleteAiServiceInput, SaveAiServiceInput,
        SetDefaultAiServiceInput,
    },
};

const SETTINGS_FILE_NAME: &str = "ai-services.json";
const SETTINGS_SCHEMA_VERSION: u32 = 1;
static STORE: OnceLock<AiServiceStore> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsFile {
    schema_version: u32,
    revision: u64,
    services: Vec<AiServiceConfig>,
    default_service_id: Option<String>,
}

impl Default for AiSettingsFile {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            revision: 0,
            services: Vec::new(),
            default_service_id: None,
        }
    }
}

pub struct AiServiceStore {
    path: PathBuf,
    credentials: Arc<dyn CredentialStore>,
    mutation_lock: Mutex<()>,
}

impl AiServiceStore {
    pub fn new(path: PathBuf, credentials: Arc<dyn CredentialStore>) -> Self {
        Self {
            path,
            credentials,
            mutation_lock: Mutex::new(()),
        }
    }

    fn load(&self) -> Result<AiSettingsFile, AiError> {
        let settings: AiSettingsFile = storage::read_json(&self.path)
            .map_err(|_| AiError::ConfigurationRead)?
            .unwrap_or_default();
        if settings.schema_version != SETTINGS_SCHEMA_VERSION {
            return Err(AiError::ConfigurationRead);
        }
        Ok(settings)
    }

    fn persist(&self, settings: &AiSettingsFile) -> Result<(), AiError> {
        storage::write_json_atomic(&self.path, settings).map_err(|_| AiError::ConfigurationWrite)
    }

    pub fn snapshot(&self) -> Result<AiServiceSettings, AiError> {
        let settings = self.load()?;
        let services = settings
            .services
            .iter()
            .map(|service| self.summary(service, settings.default_service_id.as_deref()))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(AiServiceSettings {
            schema_version: settings.schema_version,
            revision: settings.revision,
            provider_catalog: catalog::catalog()?.clone(),
            services,
            default_service_id: settings.default_service_id,
        })
    }

    pub fn save(&self, input: SaveAiServiceInput) -> Result<AiServiceSettings, AiError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| AiError::ConfigurationWrite)?;
        let mut settings = self.load()?;
        ensure_revision(settings.revision, input.expected_revision)?;
        let service = normalize_service(&settings, &input)?;
        let existing_secret = self.credentials.read(&service.id)?;
        if let Some(secret) = input.api_key.as_deref() {
            let secret = secret.trim();
            if secret.is_empty() {
                return Err(AiError::Validation("API Key 不能为空".to_owned()));
            }
            self.credentials.write(&service.id, secret)?;
        }

        if let Some(index) = settings
            .services
            .iter()
            .position(|item| item.id == service.id)
        {
            settings.services[index] = service.clone();
        } else {
            settings.services.push(service.clone());
        }
        settings.revision += 1;
        if let Err(error) = self.persist(&settings) {
            restore_secret(
                self.credentials.as_ref(),
                &service.id,
                existing_secret.as_deref(),
            );
            return Err(error);
        }
        drop(_guard);
        self.snapshot()
    }

    pub fn delete(&self, input: DeleteAiServiceInput) -> Result<AiServiceSettings, AiError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| AiError::ConfigurationWrite)?;
        let mut settings = self.load()?;
        ensure_revision(settings.revision, input.expected_revision)?;
        let index = settings
            .services
            .iter()
            .position(|service| service.id == input.id)
            .ok_or(AiError::ServiceNotFound)?;
        let existing_secret = self.credentials.read(&input.id)?;
        self.credentials.delete(&input.id)?;
        settings.services.remove(index);
        if settings.default_service_id.as_deref() == Some(input.id.as_str()) {
            settings.default_service_id = None;
        }
        settings.revision += 1;
        if let Err(error) = self.persist(&settings) {
            restore_secret(
                self.credentials.as_ref(),
                &input.id,
                existing_secret.as_deref(),
            );
            return Err(error);
        }
        drop(_guard);
        self.snapshot()
    }

    pub fn set_default(
        &self,
        input: SetDefaultAiServiceInput,
    ) -> Result<AiServiceSettings, AiError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| AiError::ConfigurationWrite)?;
        let mut settings = self.load()?;
        ensure_revision(settings.revision, input.expected_revision)?;
        if let Some(id) = input.id.as_deref()
            && !settings.services.iter().any(|service| service.id == id)
        {
            return Err(AiError::ServiceNotFound);
        }
        settings.default_service_id = input.id;
        settings.revision += 1;
        self.persist(&settings)?;
        drop(_guard);
        self.snapshot()
    }

    pub(crate) fn configured_service(&self, id: &str) -> Result<AiServiceConfig, AiError> {
        let settings = self.load()?;
        settings
            .services
            .into_iter()
            .find(|service| service.id == id)
            .ok_or(AiError::ServiceNotFound)
    }

    pub(crate) fn stored_credential(&self, id: &str) -> Result<Option<String>, AiError> {
        self.credentials.read(id)
    }

    pub(crate) fn mark_connection_ready(
        &self,
        service_id: &str,
        model_id: Option<&str>,
    ) -> Result<(), AiError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| AiError::ConfigurationWrite)?;
        let mut settings = self.load()?;
        let service = settings
            .services
            .iter_mut()
            .find(|service| service.id == service_id)
            .ok_or(AiError::ServiceNotFound)?;
        service.connection_state = ConnectionState::Ready;
        service.model_id = normalized_model(model_id).or_else(|| service.model_id.clone());
        service.revision += 1;
        settings.revision += 1;
        self.persist(&settings)
    }

    fn summary(
        &self,
        service: &AiServiceConfig,
        default_id: Option<&str>,
    ) -> Result<AiServiceSummary, AiError> {
        Ok(AiServiceSummary {
            id: service.id.clone(),
            provider_id: service.provider_id,
            display_name: service.display_name.clone(),
            protocol: service.protocol,
            base_url: service.base_url.clone(),
            model_id: service.model_id.clone(),
            credential_state: if self.credentials.read(&service.id)?.is_some() {
                CredentialState::Stored
            } else {
                CredentialState::Missing
            },
            connection_state: service.connection_state,
            capabilities: AiServiceCapabilities {
                understanding: true,
                learning: true,
                vision: false,
            },
            is_default: default_id == Some(service.id.as_str()),
            revision: service.revision,
        })
    }
}

fn normalize_service(
    settings: &AiSettingsFile,
    input: &SaveAiServiceInput,
) -> Result<AiServiceConfig, AiError> {
    let provider = catalog::provider(input.provider_id)?;
    if input.protocol != provider.protocol {
        return Err(AiError::Validation("服务协议与厂商不匹配".to_owned()));
    }
    let existing = input
        .id
        .as_deref()
        .and_then(|id| settings.services.iter().find(|service| service.id == id));
    if input.id.is_some() && existing.is_none() {
        return Err(AiError::ServiceNotFound);
    }
    if existing.is_some_and(|service| service.provider_id != input.provider_id) {
        return Err(AiError::Validation("不能更改已有服务的厂商".to_owned()));
    }
    if input.provider_id != AiProviderId::Custom
        && settings.services.iter().any(|service| {
            service.provider_id == input.provider_id
                && Some(service.id.as_str()) != input.id.as_deref()
        })
    {
        return Err(AiError::Validation("该内置服务已经配置".to_owned()));
    }
    let display_name = if input.display_name.trim().is_empty() {
        provider.display_name.clone()
    } else {
        input.display_name.trim().to_owned()
    };
    if display_name.chars().count() > 64 {
        return Err(AiError::Validation("服务名称过长".to_owned()));
    }
    let base_url = input
        .base_url
        .as_deref()
        .or(provider.official_base_url.as_deref())
        .ok_or_else(|| AiError::Validation("请输入服务地址".to_owned()))?;
    let base_url = normalize_endpoint(base_url)?;
    let model_id = input
        .model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if model_id.as_ref().is_some_and(|model| model.len() > 200) {
        return Err(AiError::Validation("模型名称过长".to_owned()));
    }
    Ok(AiServiceConfig {
        id: existing
            .map(|service| service.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        provider_id: input.provider_id,
        display_name,
        protocol: input.protocol,
        base_url,
        model_id,
        connection_state: ConnectionState::Untested,
        revision: existing.map_or(1, |service| service.revision + 1),
    })
}

pub(crate) fn normalize_endpoint(value: &str) -> Result<String, AiError> {
    let parsed =
        Url::parse(value.trim()).map_err(|_| AiError::Validation("服务地址无效".to_owned()))?;
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(AiError::Validation(
            "服务地址不能包含凭据或查询参数".to_owned(),
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| AiError::Validation("服务地址缺少主机".to_owned()))?;
    let loopback = host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1";
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err(AiError::Validation(
            "远程服务必须使用 HTTPS；HTTP 只允许本机回环地址".to_owned(),
        ));
    }
    Ok(parsed.to_string().trim_end_matches('/').to_owned())
}

fn ensure_revision(actual: u64, expected: u64) -> Result<(), AiError> {
    if actual == expected {
        Ok(())
    } else {
        Err(AiError::RevisionConflict)
    }
}

fn normalized_model(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn restore_secret(credentials: &dyn CredentialStore, id: &str, secret: Option<&str>) {
    let _ = match secret {
        Some(secret) => credentials.write(id, secret),
        None => credentials.delete(id),
    };
}

pub fn initialize(data_directory: &Path) -> Result<(), AiError> {
    let store = AiServiceStore::new(
        data_directory.join(SETTINGS_FILE_NAME),
        Arc::new(WindowsCredentialStore),
    );
    let _ = store.snapshot()?;
    STORE
        .set(store)
        .map_err(|_| AiError::Validation("AI 服务已经初始化".to_owned()))
}

pub fn store() -> Result<&'static AiServiceStore, AiError> {
    STORE.get().ok_or(AiError::NotInitialized)
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
