import { invoke } from "@tauri-apps/api/core";

import { isDesktopApp } from "../../lib/desktop";
import type { SpeechAudio, SpeechRequest, SpeechVoice } from "./speechTypes";

export async function listSpeechVoices(): Promise<SpeechVoice[]> {
  if (!isDesktopApp) {
    return [];
  }
  const value = await invoke<unknown>("list_speech_voices");
  const { default: validate } = await import("../../generated/speech-voice.validator.mjs");
  if (!Array.isArray(value)) throw invalidSpeech();
  const ids = new Set<string>();
  for (const voice of value) {
    if (!validate(voice) || !voice.id.trim() || !voice.displayName.trim() ||
        !voice.language.trim() || ids.has(voice.id)) throw invalidSpeech();
    ids.add(voice.id);
  }
  return value as SpeechVoice[];
}

export async function synthesizeSpeech(
  request: SpeechRequest,
): Promise<SpeechAudio> {
  const value = await invoke<unknown>("synthesize_speech", { request });
  const { default: validate } = await import("../../generated/speech-audio.validator.mjs");
  if (!validate(value) || !value.voiceId.trim() ||
      (request.voiceId.trim() && value.voiceId !== request.voiceId.trim()) ||
      !value.language.trim() || languageBase(value.language) !== languageBase(request.language) ||
      !/^audio\/[a-z0-9.+-]+$/i.test(value.mimeType)) throw invalidSpeech();
  return value;
}

function languageBase(language: string): string {
  return language.trim().replaceAll("_", "-").toLowerCase().split("-")[0];
}

function invalidSpeech(): Error {
  return new Error("本机语音结果格式或声音不匹配，请重新选择声音后重试。");
}
