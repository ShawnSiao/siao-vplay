use super::{CancellationCheck, GenerationInput, ProviderFailure, send_error};
use crate::ai::{AiError, network};
use reqwest::{Client, RequestBuilder, StatusCode};
use serde_json::Value;
use std::{sync::mpsc, time::Duration};

// Hard bound for untrusted provider responses, independent of token estimates.
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

pub(super) fn client(input: &GenerationInput) -> Result<Client, ProviderFailure> {
    check(input.cancellation.as_ref())?;
    network::build_async_client(
        Client::builder()
            .user_agent(format!("SiaoVPlay/{}", env!("CARGO_PKG_VERSION")))
            .connect_timeout(input.timeout.min(Duration::from_secs(30)))
            .timeout(input.timeout)
            .pool_max_idle_per_host(0),
    )
    .map_err(|_| AiError::ProviderUnavailable.into())
}

pub(super) fn send(
    request: RequestBuilder,
    input: &GenerationInput,
) -> Result<(Value, Option<String>), ProviderFailure> {
    check(input.cancellation.as_ref())?;
    let cancellation = input.cancellation.clone();
    let (sender, receiver) = mpsc::sync_channel(1);
    let worker = tauri::async_runtime::spawn(async move {
        let result = async {
            check(cancellation.as_ref())?;
            let mut response = request.send().await.map_err(send_error)?;
            let request_id = ["x-request-id", "request-id", "x-goog-request-id"]
                .iter()
                .find_map(|name| response.headers().get(*name))
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            if !response.status().is_success() {
                let error = match response.status() {
                    StatusCode::UNAUTHORIZED => AiError::Unauthorized,
                    StatusCode::FORBIDDEN => AiError::Forbidden,
                    StatusCode::NOT_FOUND => AiError::ModelNotFound,
                    StatusCode::TOO_MANY_REQUESTS => AiError::RateLimited,
                    status if status.is_server_error() => AiError::ProviderUnavailable,
                    _ => AiError::InvalidResponse,
                };
                return Err(ProviderFailure {
                    error,
                    provider_request_id: request_id,
                });
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(send_error)? {
                if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(bytes.len()) {
                    return Err(AiError::InvalidResponse.into());
                }
                bytes.extend_from_slice(&chunk);
            }
            let payload = serde_json::from_slice(&bytes).map_err(|_| ProviderFailure {
                error: AiError::InvalidResponse,
                provider_request_id: request_id.clone(),
            })?;
            Ok((payload, request_id))
        }
        .await;
        let _ = sender.send(result);
    });
    loop {
        if let Err(error) = check(input.cancellation.as_ref()) {
            worker.abort();
            let _ = tauri::async_runtime::block_on(worker);
            return Err(error);
        }
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(result) => {
                let _ = tauri::async_runtime::block_on(worker);
                check(input.cancellation.as_ref())?;
                return result;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = tauri::async_runtime::block_on(worker);
                return Err(AiError::ProviderUnavailable.into());
            }
        }
    }
}

fn check(cancellation: Option<&CancellationCheck>) -> Result<(), ProviderFailure> {
    if let Some(check) = cancellation {
        if check()? {
            return Err(AiError::Cancelled.into());
        }
    }
    Ok(())
}
