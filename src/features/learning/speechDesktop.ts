import { invoke } from "@tauri-apps/api/core";

import { isDesktopApp } from "../../lib/desktop";
import type { SpeechAudio, SpeechRequest, SpeechVoice } from "./speechTypes";

export async function listSpeechVoices(): Promise<SpeechVoice[]> {
  if (!isDesktopApp) {
    return [];
  }
  return invoke<SpeechVoice[]>("list_speech_voices");
}

export async function synthesizeSpeech(
  request: SpeechRequest,
): Promise<SpeechAudio> {
  return invoke<SpeechAudio>("synthesize_speech", { request });
}
