use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{Value, json};

use super::{
    GenerationInput, ProviderFailure, ProviderOutput, checked, client, endpoint, json_value,
    send_error,
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
    let models = payload
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
        .collect();
    Ok(models)
}

pub fn generate(
    service: &ResolvedAiService,
    input: &GenerationInput,
) -> Result<ProviderOutput, ProviderFailure> {
    let mut content = vec![json!({"type": "input_text", "text": input.prompt})];
    content.extend(
        input
            .image_data_urls
            .iter()
            .map(|url| json!({"type": "input_image", "image_url": url})),
    );
    let body = json!({
        "model": input.model_id,
        "instructions": input.system,
        "input": [{"role": "user", "content": content}],
        "store": false,
        "text": {"format": {
            "type": "json_schema",
            "name": input.schema_name,
            "strict": true,
            "schema": input.schema
        }}
    });
    let response = client()?
        .post(endpoint(&service.base_url, "/responses"))
        .header(AUTHORIZATION, format!("Bearer {}", service.api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .map_err(send_error)?;
    let (payload, request_id) = json_value(checked(response, AiError::ModelNotFound)?)?;
    let output_text = payload
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .find_map(|content| {
            (content.get("type").and_then(Value::as_str) == Some("output_text"))
                .then(|| content.get("text").and_then(Value::as_str))
                .flatten()
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
    fn responses_request_disables_storage_and_parses_structured_output() {
        let server = serve_once(
            200,
            r#"{"id":"resp_1","output":[{"content":[{"type":"output_text","text":"{\"ok\":true}"}]}],"usage":{"total_tokens":3}}"#,
        );
        let service = mock_service(
            AiProviderId::Openai,
            AiProtocol::OpenaiResponses,
            &server.url,
        );
        let output = generate(&service, &server.generation_input()).expect("response");
        let request = server.finish();
        assert!(request.contains("POST /responses"));
        assert!(request.contains("\"store\":false"));
        assert_eq!(output.output_text, r#"{"ok":true}"#);
    }
}
