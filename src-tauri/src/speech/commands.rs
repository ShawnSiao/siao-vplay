use serde::Serialize;

use super::{SpeechAudio, SpeechError, SpeechRequest, SpeechVoice};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCommandError {
    code: &'static str,
    message: String,
}

impl From<SpeechError> for SpeechCommandError {
    fn from(error: SpeechError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

impl SpeechCommandError {
    fn background(message: impl ToString) -> Self {
        Self {
            code: "speech_background_error",
            message: format!("Windows 本地语音任务未能完成：{}", message.to_string()),
        }
    }
}

#[tauri::command]
pub async fn list_speech_voices() -> Result<Vec<SpeechVoice>, SpeechCommandError> {
    tauri::async_runtime::spawn_blocking(super::list_voices)
        .await
        .map_err(SpeechCommandError::background)?
        .map_err(Into::into)
}

#[tauri::command]
pub async fn synthesize_speech(request: SpeechRequest) -> Result<SpeechAudio, SpeechCommandError> {
    tauri::async_runtime::spawn_blocking(move || super::synthesize(request))
        .await
        .map_err(SpeechCommandError::background)?
        .map_err(Into::into)
}
