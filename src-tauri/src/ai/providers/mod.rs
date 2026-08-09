mod anthropic_messages;
mod gemini_generate_content;
mod openai_compatible;
mod openai_responses;

#[cfg(test)]
pub(crate) mod test_support;

use std::time::Duration;

use reqwest::{
    StatusCode,
    blocking::{Client, Response},
};
use serde_json::Value;

use super::{
    catalog,
    error::AiError,
    network,
    types::{AiModelInfo, AiProtocol, AiProviderId, ResolvedAiService},
};

pub struct GenerationInput {
    pub model_id: String,
    pub system: String,
    pub prompt: String,
    pub schema_name: String,
    pub schema: Value,
    pub image_data_urls: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ProviderOutput {
    pub output_text: String,
    pub provider_request_id: Option<String>,
    pub usage: Option<Value>,
}

#[derive(Debug)]
pub struct ProviderFailure {
    pub error: AiError,
    pub provider_request_id: Option<String>,
}

impl From<AiError> for ProviderFailure {
    fn from(error: AiError) -> Self {
        Self {
            error,
            provider_request_id: None,
        }
    }
}

pub fn list_models(service: &ResolvedAiService) -> Result<Vec<AiModelInfo>, ProviderFailure> {
    let mut models = match service.protocol {
        AiProtocol::OpenaiResponses => openai_responses::list_models(service),
        AiProtocol::AnthropicMessages => anthropic_messages::list_models(service),
        AiProtocol::GeminiGenerateContent => gemini_generate_content::list_models(service),
        AiProtocol::OpenaiChatCompletions => openai_compatible::list_models(service),
    }?;
    let prefixes = catalog::provider(service.provider_id)
        .map(|provider| provider.vision_model_prefixes.clone())
        .unwrap_or_default();
    for model in &mut models {
        if service.provider_id == AiProviderId::Custom {
            model.vision = false;
            model.capability_source = "custom_text_only_policy".to_owned();
        } else if prefixes.iter().any(|prefix| model.id.starts_with(prefix)) {
            model.vision = true;
            model.capability_source = "provider_catalog".to_owned();
        }
    }
    Ok(models)
}

pub fn generate(
    service: &ResolvedAiService,
    input: &GenerationInput,
) -> Result<ProviderOutput, ProviderFailure> {
    match service.protocol {
        AiProtocol::OpenaiResponses => openai_responses::generate(service, input),
        AiProtocol::AnthropicMessages => anthropic_messages::generate(service, input),
        AiProtocol::GeminiGenerateContent => gemini_generate_content::generate(service, input),
        AiProtocol::OpenaiChatCompletions => openai_compatible::generate(service, input),
    }
}

pub(super) fn client() -> Result<Client, ProviderFailure> {
    client_with_timeout(Duration::from_secs(90))
}

fn client_with_timeout(timeout: Duration) -> Result<Client, ProviderFailure> {
    let builder = Client::builder()
        .user_agent(format!("SiaoVPlay/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(timeout.min(Duration::from_secs(30)))
        .timeout(timeout);
    network::build_client(builder).map_err(|_| ProviderFailure::from(AiError::ProviderUnavailable))
}

pub(super) fn endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

pub(super) fn checked(response: Response, not_found: AiError) -> Result<Response, ProviderFailure> {
    if response.status().is_success() {
        return Ok(response);
    }
    let request_id = response_request_id(&response);
    let error = match response.status() {
        StatusCode::UNAUTHORIZED => AiError::Unauthorized,
        StatusCode::FORBIDDEN => AiError::Forbidden,
        StatusCode::NOT_FOUND => not_found,
        StatusCode::TOO_MANY_REQUESTS => AiError::RateLimited,
        status if status.is_server_error() => AiError::ProviderUnavailable,
        _ => AiError::InvalidResponse,
    };
    Err(ProviderFailure {
        error,
        provider_request_id: request_id,
    })
}

pub(super) fn send_error(error: reqwest::Error) -> ProviderFailure {
    ProviderFailure::from(if error.is_timeout() {
        AiError::Timeout
    } else {
        AiError::ProviderUnavailable
    })
}

pub(super) fn response_request_id(response: &Response) -> Option<String> {
    ["x-request-id", "request-id", "x-goog-request-id"]
        .iter()
        .find_map(|name| response.headers().get(*name))
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

pub(super) fn parse_data_url(value: &str) -> Option<(&str, &str)> {
    let value = value.strip_prefix("data:")?;
    let (metadata, data) = value.split_once(',')?;
    let media_type = metadata.strip_suffix(";base64")?;
    if media_type.starts_with("image/") && !data.is_empty() {
        Some((media_type, data))
    } else {
        None
    }
}

pub(super) fn json_value(response: Response) -> Result<(Value, Option<String>), ProviderFailure> {
    let request_id = response_request_id(&response);
    let payload = response.json::<Value>().map_err(|_| ProviderFailure {
        error: AiError::InvalidResponse,
        provider_request_id: request_id.clone(),
    })?;
    Ok((payload, request_id))
}

#[cfg(test)]
mod contract_tests {
    use std::time::Duration;

    use super::test_support::{serve_once, serve_once_after};
    use super::*;

    #[test]
    fn common_http_statuses_map_to_stable_errors_without_response_bodies() {
        let cases = [
            (401, AiError::Unauthorized.code()),
            (403, AiError::Forbidden.code()),
            (404, AiError::ModelNotFound.code()),
            (429, AiError::RateLimited.code()),
            (500, AiError::ProviderUnavailable.code()),
        ];
        for (status, expected) in cases {
            let server = serve_once(status, r#"{"secret":"must-not-surface"}"#);
            let response = client()
                .expect("client")
                .get(&server.url)
                .send()
                .expect("response");
            let failure = checked(response, AiError::ModelNotFound).expect_err("failure");
            assert_eq!(failure.error.code(), expected);
            let _request = server.finish();
        }
    }

    #[test]
    fn invalid_json_is_rejected_as_an_invalid_response() {
        let server = serve_once(200, "not-json");
        let response = client()
            .expect("client")
            .get(&server.url)
            .send()
            .expect("response");
        let failure = json_value(response).expect_err("invalid response");
        assert_eq!(failure.error.code(), AiError::InvalidResponse.code());
        let _request = server.finish();
    }

    #[test]
    fn request_timeout_maps_to_the_stable_timeout_error() {
        let server = serve_once_after(200, "{}", Duration::from_millis(100));
        let error = client_with_timeout(Duration::from_millis(10))
            .expect("client")
            .get(&server.url)
            .send()
            .expect_err("timeout");
        assert_eq!(send_error(error).error.code(), AiError::Timeout.code());
        let _request = server.finish();
    }
}
