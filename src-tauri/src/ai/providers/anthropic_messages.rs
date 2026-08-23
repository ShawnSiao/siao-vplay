use reqwest::header::CONTENT_TYPE;
use serde_json::{Value, json};

use super::{
    GenerationInput, ProviderFailure, ProviderOutput, checked, client, endpoint, generation_client,
    json_value, parse_data_url, send_error,
};
use crate::ai::{
    error::AiError,
    types::{AiModelInfo, ResolvedAiService},
};

fn request(
    service: &ResolvedAiService,
    method: reqwest::Method,
    path: &str,
) -> Result<reqwest::blocking::RequestBuilder, ProviderFailure> {
    Ok(client()?
        .request(method, endpoint(&service.base_url, path))
        .header("x-api-key", &service.api_key)
        .header("anthropic-version", "2023-06-01"))
}

pub fn list_models(service: &ResolvedAiService) -> Result<Vec<AiModelInfo>, ProviderFailure> {
    let response = request(service, reqwest::Method::GET, "/v1/models")?
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
    let mut content = vec![json!({"type": "text", "text": input.prompt})];
    content.extend(input.image_data_urls.iter().filter_map(|url| {
        parse_data_url(url).map(|(media_type, data)| {
            json!({"type": "image", "source": {
                "type": "base64", "media_type": media_type, "data": data
            }})
        })
    }));
    let body = json!({
        "model": input.model_id,
        "max_tokens": input.max_output_tokens,
        "system": format!("{}\n只返回符合此 JSON Schema 的 JSON：{}", input.system, input.schema),
        "messages": [{"role": "user", "content": content}]
    });
    let response = generation_client(input)?
        .post(endpoint(&service.base_url, "/v1/messages"))
        .header("x-api-key", &service.api_key)
        .header("anthropic-version", "2023-06-01")
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .map_err(send_error)?;
    let (payload, request_id) = json_value(checked(response, AiError::ModelNotFound)?)?;
    let output_text = payload
        .get("content")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                (item.get("type").and_then(Value::as_str) == Some("text"))
                    .then(|| item.get("text").and_then(Value::as_str))
                    .flatten()
            })
        })
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
    fn messages_request_separates_system_and_user_content() {
        let server = serve_once(
            200,
            r#"{"id":"msg_1","content":[{"type":"text","text":"{\"ok\":true}"}],"usage":{"input_tokens":2}}"#,
        );
        let service = mock_service(
            AiProviderId::Anthropic,
            AiProtocol::AnthropicMessages,
            &server.url,
        );
        generate(&service, &server.generation_input()).expect("message");
        let request = server.finish();
        assert!(request.contains("POST /v1/messages"));
        assert!(request.to_ascii_lowercase().contains("x-api-key: test-key"));
        assert!(request.contains("\"system\""));
    }
}
