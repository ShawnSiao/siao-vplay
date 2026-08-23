use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{Value, json};

use super::{
    GenerationInput, ProviderFailure, ProviderOutput, checked, client, endpoint, generation_client,
    json_value, send_error,
};
use crate::ai::{
    error::AiError,
    types::{AiModelInfo, ResolvedAiService},
};

pub fn list_models(service: &ResolvedAiService) -> Result<Vec<AiModelInfo>, ProviderFailure> {
    let response = client()?
        .get(endpoint(&service.base_url, "/models"))
        .header(AUTHORIZATION, format!("Bearer {}", service.api_key))
        .send()
        .map_err(send_error)?;
    let (payload, _) = json_value(checked(response, AiError::ProviderUnavailable)?)?;
    Ok(payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or(AiError::InvalidResponse)?
        .iter()
        .filter_map(|model| model.get("id").and_then(Value::as_str))
        .map(|id| AiModelInfo {
            id: id.to_owned(),
            display_name: id.to_owned(),
            vision: false,
            capability_source: "unknown".to_owned(),
        })
        .collect())
}

pub fn generate(
    service: &ResolvedAiService,
    input: &GenerationInput,
) -> Result<ProviderOutput, ProviderFailure> {
    let schema_instruction = format!(
        "{}\n只返回符合 JSON Schema `{}` 的 JSON：{}",
        input.system, input.schema_name, input.schema
    );
    let body = json!({
        "model": input.model_id,
        "messages": [
            {"role": "system", "content": schema_instruction},
            {"role": "user", "content": input.prompt}
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": input.max_output_tokens,
        "stream": false
    });
    let response = generation_client(input)?
        .post(endpoint(&service.base_url, "/chat/completions"))
        .header(AUTHORIZATION, format!("Bearer {}", service.api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .map_err(send_error)?;
    let (payload, request_id) = json_value(checked(response, AiError::ModelNotFound)?)?;
    let output_text = payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or(AiError::InvalidResponse)?
        .to_owned();
    Ok(ProviderOutput {
        output_text,
        provider_request_id: payload
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or(request_id),
        usage: payload.get("usage").cloned(),
    })
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{mock_service, serve_once};
    use super::*;
    use crate::ai::types::{AiProtocol, AiProviderId};

    #[test]
    fn chat_completions_requests_json_and_parses_usage() {
        let server = serve_once(
            200,
            r#"{"id":"chat_1","choices":[{"message":{"content":"{\"ok\":true}"}}],"usage":{"total_tokens":3}}"#,
        );
        let service = mock_service(
            AiProviderId::Deepseek,
            AiProtocol::OpenaiChatCompletions,
            &server.url,
        );
        let output = generate(&service, &server.generation_input()).expect("response");
        let request = server.finish();
        assert!(request.contains("POST /chat/completions"));
        assert!(request.contains("json_object"));
        assert!(!request.contains("image_url"));
        assert_eq!(output.output_text, r#"{"ok":true}"#);
    }
}
