export type SpeechVoice = {
  id: string;
  displayName: string;
  language: string;
};

export type SpeechRequest = {
  text: string;
  language: string;
  voiceId: string;
};

export type SpeechAudio = {
  bytes: number[];
  mimeType: string;
  voiceId: string;
  language: string;
};

export type SpeechPlaybackState =
  | { kind: "idle" }
  | { kind: "synthesizing" | "playing"; sourceId: string };
