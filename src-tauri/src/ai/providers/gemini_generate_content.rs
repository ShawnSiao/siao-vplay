use reqwest::header::CONTENT_TYPE;
use serde_json::{Value, json};

use super::{
    GenerationInput, ProviderFailure, ProviderOutput, checked, client, endpoint, generation_client,
    json_value, send_generation, parse_data_url, send_error,
};
use crate::ai::{
    error::AiError,
    types::{AiModelInfo, ResolvedAiService},
};

pub fn list_models(service: &ResolvedAiService) -> Result<Vec<AiModelInfo>, ProviderFailure> {
    let response = client()?
        .get(endpoint(&service.base_url, "/models"))
        .header("x-goog-api-key", &service.api_key)
        .send()
        .map_err(send_error)?;
    let (payload, _) = json_value(checked(response, AiError::ProviderUnavailable)?)?;
    Ok(payload
        .get("models")
        .and_then(Value::as_array)
        .ok_or(AiError::InvalidResponse)?
        .iter()
        .filter(|model| {
            model
                .get("supportedGenerationMethods")
                .and_then(Value::as_array)
                .is_none_or(|methods| methods.iter().any(|method| method == "generateContent"))
        })
        .filter_map(|model| {
            let id = model
                .get("baseModelId")
                .or_else(|| model.get("name"))?
                .as_str()?
                .trim_start_matches("models/");
            Some(AiModelInfo {
                id: id.to_owned(),
                display_name: model
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .to_owned(),
                vision: false,
                capability_source: "unknown".to_owned(),
            })
        })
        .collect())
}

pub fn generate(
    service: &ResolvedAiService,
    input: &GenerationInput,
) -> Result<ProviderOutput, ProviderFailure> {
    let mut parts = vec![json!({
        "text": format!("{}\n\n{}", input.system, input.prompt)
    })];
    parts.extend(input.image_data_urls.iter().filter_map(|url| {
        parse_data_url(url)
            .map(|(mime_type, data)| json!({"inlineData": {"mimeType": mime_type, "data": data}}))
    }));
    let body = json!({
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": input.schema,
            "maxOutputTokens": input.max_output_tokens
        }
    });
    let path = format!("/models/{}:generateContent", input.model_id);
    let request = generation_client(input)?
        .post(endpoint(&service.base_url, &path))
        .header("x-goog-api-key", &service.api_key)
        .header(CONTENT_TYPE, "application/json")
        .json(&body);
    let (payload, request_id) = send_generation(request, input)?;
    let output_text = payload
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .ok_or(AiError::InvalidResponse)?
        .to_owned();
    Ok(ProviderOutput {
        output_text,
        provider_request_id: request_id,
        usage: payload.get("usageMetadata").cloned(),
    })
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{mock_service, serve_once};
    use super::*;
    use crate::ai::types::{AiProtocol, AiProviderId};

    #[test]
    fn generate_content_uses_json_schema_and_api_key_header() {
        let server = serve_once(
            200,
            r#"{"candidates":[{"content":{"parts":[{"text":"{\"ok\":true}"}]}}],"usageMetadata":{"totalTokenCount":3}}"#,
        );
        let service = mock_service(
            AiProviderId::Gemini,
            AiProtocol::GeminiGenerateContent,
            &server.url,
        );
        let output = generate(&service, &server.generation_input()).expect("response");
        let request = server.finish();
        assert!(request.contains("POST /models/test-model:generateContent"));
        assert!(
            request
                .to_ascii_lowercase()
                .contains("x-goog-api-key: test-key")
        );
        assert!(request.contains("responseJsonSchema"));
        assert_eq!(output.output_text, r#"{"ok":true}"#);
    }
}
