export type { SpeechVoice } from "../../generated/speech-voice";
export type { SpeechAudio } from "../../generated/speech-audio";

export type SpeechRequest = {
  text: string;
  language: string;
  voiceId: string;
};

export type SpeechPlaybackState =
  | { kind: "idle" }
  | { kind: "synthesizing" | "playing"; sourceId: string };
