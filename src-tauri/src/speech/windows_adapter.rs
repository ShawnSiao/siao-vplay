use windows::{
    Media::SpeechSynthesis::{SpeechSynthesizer, VoiceInformation},
    Storage::Streams::DataReader,
    core::HSTRING,
};

use super::{
    MAX_AUDIO_BYTES, SpeechAudio, SpeechError, SpeechRequest, SpeechVoice, language_matches,
};

pub(super) fn list_voices() -> Result<Vec<SpeechVoice>, SpeechError> {
    let installed = SpeechSynthesizer::AllVoices().map_err(platform_error)?;
    let mut voices = Vec::with_capacity(installed.Size().map_err(platform_error)? as usize);
    for index in 0..installed.Size().map_err(platform_error)? {
        let voice = installed.GetAt(index).map_err(platform_error)?;
        voices.push(SpeechVoice {
            id: voice.Id().map_err(platform_error)?.to_string(),
            display_name: voice.DisplayName().map_err(platform_error)?.to_string(),
            language: voice.Language().map_err(platform_error)?.to_string(),
        });
    }
    voices.sort_by(|left, right| {
        left.language
            .cmp(&right.language)
            .then(left.display_name.cmp(&right.display_name))
            .then(left.id.cmp(&right.id))
    });
    Ok(voices)
}

pub(super) fn synthesize(request: SpeechRequest) -> Result<SpeechAudio, SpeechError> {
    let installed = SpeechSynthesizer::AllVoices().map_err(platform_error)?;
    let voices = (0..installed.Size().map_err(platform_error)?)
        .map(|index| installed.GetAt(index).map_err(platform_error))
        .collect::<Result<Vec<_>, _>>()?;
    let voice = select_voice(&voices, &request)?;
    let voice_id = voice.Id().map_err(platform_error)?.to_string();
    let voice_language = voice.Language().map_err(platform_error)?.to_string();
    let synthesizer = SpeechSynthesizer::new().map_err(platform_error)?;
    synthesizer.SetVoice(&voice).map_err(platform_error)?;
    let stream = synthesizer
        .SynthesizeTextToStreamAsync(&HSTRING::from(&request.text))
        .map_err(platform_error)?
        .join()
        .map_err(platform_error)?;
    let size = stream.Size().map_err(platform_error)?;
    if size > MAX_AUDIO_BYTES || size > u32::MAX as u64 {
        return Err(SpeechError::AudioTooLarge);
    }
    let input = stream.GetInputStreamAt(0).map_err(platform_error)?;
    let reader = DataReader::CreateDataReader(&input).map_err(platform_error)?;
    let loaded = reader
        .LoadAsync(size as u32)
        .map_err(platform_error)?
        .join()
        .map_err(platform_error)?;
    let mut bytes = vec![0; loaded as usize];
    reader.ReadBytes(&mut bytes).map_err(platform_error)?;
    Ok(SpeechAudio {
        bytes,
        mime_type: stream.ContentType().map_err(platform_error)?.to_string(),
        voice_id,
        language: voice_language,
    })
}

fn select_voice(
    installed: &[VoiceInformation],
    request: &SpeechRequest,
) -> Result<VoiceInformation, SpeechError> {
    let mut base_match = None;
    for voice in installed {
        let id = voice.Id().map_err(platform_error)?.to_string();
        let language = voice.Language().map_err(platform_error)?.to_string();
        if !request.voice_id.is_empty() && id == request.voice_id {
            return language_matches(&request.language, &language)
                .then_some(voice.clone())
                .ok_or(SpeechError::VoiceLanguageMismatch);
        }
        if request.voice_id.is_empty() && language.eq_ignore_ascii_case(&request.language) {
            return Ok(voice.clone());
        }
        if request.voice_id.is_empty()
            && base_match.is_none()
            && language_matches(&request.language, &language)
        {
            base_match = Some(voice.clone());
        }
    }
    if request.voice_id.is_empty() {
        base_match.ok_or_else(|| SpeechError::MissingVoice(request.language.clone()))
    } else {
        Err(SpeechError::MissingVoice(request.language.clone()))
    }
}

fn platform_error(error: windows::core::Error) -> SpeechError {
    SpeechError::Platform(error.message())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_windows_voice_inventory_is_readable() {
        list_voices().expect("Windows voice inventory should be readable");
    }

    #[test]
    #[ignore = "uses an installed Windows voice and performs real local speech synthesis"]
    fn real_windows_voice_synthesizes_an_in_memory_wave() {
        let voice = list_voices()
            .expect("voice inventory")
            .into_iter()
            .next()
            .expect("at least one Windows voice");
        let audio = synthesize(SpeechRequest {
            text: "SiaoVPlay".to_owned(),
            language: voice.language,
            voice_id: voice.id,
        })
        .expect("speech should synthesize");
        assert!(!audio.bytes.is_empty());
        assert!(audio.mime_type.to_ascii_lowercase().contains("wav"));
    }
}
