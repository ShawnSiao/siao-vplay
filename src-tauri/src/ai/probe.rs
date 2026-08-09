use serde_json::json;

use super::{
    config, connection,
    error::{AiCommandError, AiError},
    providers::{self, GenerationInput, ProviderFailure},
    types::{
        AiModelInfo, AiModelList, AiServiceCapabilities, AiServiceProbeInput, AiServiceTestResult,
        ConnectionState,
    },
};

pub fn list_models(input: AiServiceProbeInput) -> Result<AiModelList, AiCommandError> {
    let service = connection::resolve_probe(&input)?;
    let models = providers::list_models(&service).map_err(command_error)?;
    Ok(AiModelList {
        models,
        manual_entry_allowed: true,
    })
}

pub fn test_service(input: AiServiceProbeInput) -> Result<AiServiceTestResult, AiCommandError> {
    let service = connection::resolve_probe(&input)?;
    let model_result = providers::list_models(&service);
    let selected_model_id = service.model_id.clone();
    let (models, minimal_request_used, provider_request_id) = match model_result {
        Ok(models) => {
            ensure_selected_model(&models, selected_model_id.as_deref())?;
            (models, false, None)
        }
        Err(failure) if may_fallback_to_generation(&failure) && selected_model_id.is_some() => {
            let output = providers::generate(
                &service,
                &connection_test_input(selected_model_id.as_deref().unwrap_or_default()),
            )
            .map_err(command_error)?;
            validate_connection_output(&output.output_text)?;
            let _usage = output.usage;
            (Vec::new(), true, output.provider_request_id)
        }
        Err(failure) => return Err(command_error(failure)),
    };
    if let Some(service_id) = service.service_config_id.as_deref() {
        config::store()?.mark_connection_ready(service_id, selected_model_id.as_deref())?;
    }
    Ok(AiServiceTestResult {
        state: ConnectionState::Ready,
        capabilities: AiServiceCapabilities {
            understanding: true,
            learning: true,
            vision: selected_model_id
                .as_deref()
                .and_then(|selected| models.iter().find(|model| model.id == selected))
                .is_some_and(|model| model.vision),
        },
        models,
        selected_model_id,
        minimal_request_used,
        may_incur_usage: minimal_request_used,
        provider_request_id,
    })
}

fn ensure_selected_model(models: &[AiModelInfo], selected: Option<&str>) -> Result<(), AiError> {
    if selected
        .is_some_and(|selected| !models.is_empty() && !models.iter().any(|m| m.id == selected))
    {
        Err(AiError::ModelNotFound)
    } else {
        Ok(())
    }
}

fn may_fallback_to_generation(failure: &ProviderFailure) -> bool {
    matches!(
        failure.error,
        AiError::ProviderUnavailable | AiError::InvalidResponse
    )
}

fn connection_test_input(model_id: &str) -> GenerationInput {
    GenerationInput {
        model_id: model_id.to_owned(),
        system: "这是连接测试。不要使用任何外部材料。".to_owned(),
        prompt: "返回 JSON：{\"ok\":true}".to_owned(),
        schema_name: "connection_test".to_owned(),
        schema: json!({
            "type": "object",
            "properties": {"ok": {"type": "boolean", "const": true}},
            "required": ["ok"],
            "additionalProperties": false
        }),
        image_data_urls: Vec::new(),
    }
}

fn validate_connection_output(output: &str) -> Result<(), AiError> {
    let value: serde_json::Value =
        serde_json::from_str(output).map_err(|_| AiError::InvalidResponse)?;
    if value.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err(AiError::InvalidResponse)
    }
}

fn command_error(failure: ProviderFailure) -> AiCommandError {
    AiCommandError::from(failure.error).with_request_id(failure.provider_request_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_model_must_match_a_discovered_model() {
        let models = vec![AiModelInfo {
            id: "available".to_owned(),
            display_name: "Available".to_owned(),
            vision: false,
            capability_source: "unknown".to_owned(),
        }];
        assert!(ensure_selected_model(&models, Some("missing")).is_err());
        assert!(ensure_selected_model(&[], Some("manual-model")).is_ok());
    }

    #[test]
    fn fixed_connection_result_is_strictly_validated() {
        assert!(validate_connection_output(r#"{"ok":true}"#).is_ok());
        assert!(validate_connection_output(r#"{"ok":false}"#).is_err());
        assert!(validate_connection_output("not-json").is_err());
    }
}
