use serde::{Deserialize, Serialize};
use thiserror::Error;

pub(crate) mod commands;
#[cfg(windows)]
mod windows_adapter;

const MAX_SPEECH_CHARACTERS: usize = 1_000;
#[cfg(windows)]
const MAX_AUDIO_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechVoice {
    pub id: String,
    pub display_name: String,
    pub language: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    pub text: String,
    pub language: String,
    pub voice_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAudio {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub voice_id: String,
    pub language: String,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Error)]
pub enum SpeechError {
    #[error("朗读内容不能为空")]
    EmptyText,
    #[error("朗读内容不能超过 {MAX_SPEECH_CHARACTERS} 个字符")]
    TextTooLong,
    #[error("语言代码无效")]
    InvalidLanguage,
    #[error(
        "未安装 {0} 对应的 Windows 语音。请在 Windows 设置的「时间和语言 → 语言和区域」中安装该语言的语音包。"
    )]
    MissingVoice(String),
    #[error("所选声音与当前内容语言不匹配")]
    VoiceLanguageMismatch,
    #[error("Windows 本地语音暂不可用：{0}")]
    Platform(String),
    #[error("合成音频超过本次词句朗读的大小限制")]
    AudioTooLarge,
    #[cfg(not(windows))]
    #[error("当前平台不支持 Windows 本地语音")]
    UnsupportedPlatform,
}

impl SpeechError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::EmptyText | Self::TextTooLong | Self::InvalidLanguage => {
                "speech_validation_error"
            }
            Self::MissingVoice(_) => "speech_voice_missing",
            Self::VoiceLanguageMismatch => "speech_voice_mismatch",
            Self::Platform(_) => "speech_platform_error",
            Self::AudioTooLarge => "speech_audio_too_large",
            #[cfg(not(windows))]
            Self::UnsupportedPlatform => "speech_unsupported_platform",
        }
    }
}

pub(crate) fn validate_request(mut request: SpeechRequest) -> Result<SpeechRequest, SpeechError> {
    request.text = request.text.trim().to_owned();
    request.language = request.language.trim().to_owned();
    request.voice_id = request.voice_id.trim().to_owned();
    if request.text.is_empty() {
        return Err(SpeechError::EmptyText);
    }
    if request.text.chars().count() > MAX_SPEECH_CHARACTERS {
        return Err(SpeechError::TextTooLong);
    }
    if request.language.is_empty()
        || request.language.len() > 35
        || !request
            .language
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(SpeechError::InvalidLanguage);
    }
    Ok(request)
}

fn normalized_language(language: &str) -> String {
    language.trim().replace('_', "-").to_ascii_lowercase()
}

fn base_language(language: &str) -> &str {
    language.split('-').next().unwrap_or(language)
}

#[cfg(any(windows, test))]
pub(crate) fn language_matches(requested: &str, voice_language: &str) -> bool {
    let requested = normalized_language(requested);
    let voice = normalized_language(voice_language);
    requested == voice || base_language(&requested) == base_language(&voice)
}

pub fn list_voices() -> Result<Vec<SpeechVoice>, SpeechError> {
    #[cfg(windows)]
    {
        windows_adapter::list_voices()
    }
    #[cfg(not(windows))]
    {
        Err(SpeechError::UnsupportedPlatform)
    }
}

pub fn synthesize(request: SpeechRequest) -> Result<SpeechAudio, SpeechError> {
    let request = validate_request(request)?;
    #[cfg(windows)]
    {
        windows_adapter::synthesize(request)
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        Err(SpeechError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_matching_prefers_only_the_same_bcp47_base() {
        assert!(language_matches("en", "en-US"));
        assert!(language_matches("ja-JP", "ja-JP"));
        assert!(!language_matches("th-TH", "en-US"));
        assert!(!language_matches("ko-KR", "ja-JP"));
    }

    #[test]
    fn request_validation_trims_text_and_rejects_invalid_languages() {
        let request = validate_request(SpeechRequest {
            text: "  hello  ".to_owned(),
            language: "en-US".to_owned(),
            voice_id: "voice".to_owned(),
        })
        .unwrap();
        assert_eq!(request.text, "hello");
        assert!(matches!(
            validate_request(SpeechRequest {
                text: "hello".to_owned(),
                language: "../../en".to_owned(),
                voice_id: String::new(),
            }),
            Err(SpeechError::InvalidLanguage)
        ));
    }
}
