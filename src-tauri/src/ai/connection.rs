use super::{
    catalog, config,
    error::AiError,
    types::{AiExecutionTarget, AiServiceProbeInput, ResolvedAiService},
};

pub fn resolve_probe(input: &AiServiceProbeInput) -> Result<ResolvedAiService, AiError> {
    if let Some(id) = input.service_config_id.as_deref() {
        let store = config::store()?;
        let service = store.configured_service(id)?;
        if service.provider_id != input.provider_id || service.protocol != input.protocol {
            return Err(AiError::Validation("服务配置已经发生变化".to_owned()));
        }
        return Ok(ResolvedAiService {
            service_config_id: Some(service.id.clone()),
            provider_id: service.provider_id,
            protocol: service.protocol,
            base_url: service.base_url,
            model_id: normalized(input.model_id.as_deref()).or(service.model_id),
            api_key: secret(input.api_key.as_deref(), store.stored_credential(id)?)?,
        });
    }
    let provider = catalog::provider(input.provider_id)?;
    if provider.protocol != input.protocol {
        return Err(AiError::Validation("服务协议与厂商不匹配".to_owned()));
    }
    let base_url = input
        .base_url
        .as_deref()
        .or(provider.official_base_url.as_deref())
        .ok_or_else(|| AiError::Validation("请输入服务地址".to_owned()))?;
    Ok(ResolvedAiService {
        service_config_id: None,
        provider_id: input.provider_id,
        protocol: input.protocol,
        base_url: config::normalize_endpoint(base_url)?,
        model_id: normalized(input.model_id.as_deref()),
        api_key: secret(input.api_key.as_deref(), None)?,
    })
}

pub fn resolve_execution(
    execution: &AiExecutionTarget,
    expected_revision: Option<u64>,
) -> Result<ResolvedAiService, AiError> {
    let AiExecutionTarget::Api {
        service_config_id,
        model_id,
    } = execution
    else {
        return Err(AiError::Validation("当前执行方式不是 API 服务".to_owned()));
    };
    let store = config::store()?;
    let service = store.configured_service(service_config_id)?;
    if expected_revision != Some(service.revision) {
        return Err(AiError::RevisionConflict);
    }
    let model_id = normalized(Some(model_id))
        .ok_or_else(|| AiError::Validation("请选择或填写模型".to_owned()))?;
    Ok(ResolvedAiService {
        service_config_id: Some(service.id.clone()),
        provider_id: service.provider_id,
        protocol: service.protocol,
        base_url: service.base_url,
        model_id: Some(model_id),
        api_key: secret(None, store.stored_credential(service_config_id)?)?,
    })
}

fn normalized(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn secret(provided: Option<&str>, stored: Option<String>) -> Result<String, AiError> {
    normalized(provided)
        .or(stored)
        .ok_or(AiError::CredentialMissing)
}
