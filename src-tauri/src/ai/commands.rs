use super::{
    config,
    error::AiCommandError,
    network,
    types::{
        AiServiceSettings, DeleteAiServiceInput, NetworkSettings, SaveAiServiceInput,
        SetDefaultAiServiceInput, SetNetworkSettingsInput,
    },
};
use crate::{
    local_resources::{self, SetLocalResourceProxyInput},
    resource_download::{self, ResourceNetworkStatus},
};

#[tauri::command]
pub fn get_ai_service_settings() -> Result<AiServiceSettings, AiCommandError> {
    config::store()?.snapshot().map_err(Into::into)
}

#[tauri::command]
pub fn save_ai_service(input: SaveAiServiceInput) -> Result<AiServiceSettings, AiCommandError> {
    config::store()?.save(input).map_err(Into::into)
}

#[tauri::command]
pub fn delete_ai_service(input: DeleteAiServiceInput) -> Result<AiServiceSettings, AiCommandError> {
    config::store()?.delete(input).map_err(Into::into)
}

#[tauri::command]
pub fn set_default_ai_service(
    input: SetDefaultAiServiceInput,
) -> Result<AiServiceSettings, AiCommandError> {
    config::store()?.set_default(input).map_err(Into::into)
}

#[tauri::command]
pub fn get_network_settings() -> Result<NetworkSettings, AiCommandError> {
    network::settings().map_err(Into::into)
}

#[tauri::command]
pub fn set_network_settings(
    input: SetNetworkSettingsInput,
) -> Result<NetworkSettings, AiCommandError> {
    network::set_settings(input).map_err(Into::into)
}

#[tauri::command]
pub fn get_local_resource_network_status() -> ResourceNetworkStatus {
    resource_download::network_status()
}

#[tauri::command]
pub fn set_local_resource_proxy(
    input: SetLocalResourceProxyInput,
) -> Result<ResourceNetworkStatus, AiCommandError> {
    local_resources::set_proxy_url(input.proxy_url.as_deref()).map_err(|error| AiCommandError {
        code: "local_resource_proxy_invalid",
        message: error.to_string(),
    })?;
    network::set_custom_proxy_compat(input.proxy_url.as_deref()).map_err(AiCommandError::from)?;
    Ok(resource_download::network_status())
}
