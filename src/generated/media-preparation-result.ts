/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type PlaybackDecision = "direct" | "runtime_validation_required" | "proxy_required" | "unsupported";
export type PlaybackSourceKind = "original" | "proxy";
export type MediaArtifactStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export interface MediaPreparation {
  inspection: MediaInspection;
  playbackPath: string;
  playbackSourceKind: PlaybackSourceKind;
  proxyArtifact: MediaArtifact | null;
  reusedProxy: boolean;
  [k: string]: unknown;
}
export interface MediaInspection {
  ffmpegVersion: string;
  mediaSourceId: string;
  playbackGate: PlaybackGate;
  probe: MediaProbe;
  projectId: string;
  reusedProbe: boolean;
  sourceSha256: string;
  [k: string]: unknown;
}
export interface PlaybackGate {
  decision: PlaybackDecision;
  reasonCodes: string[];
  requiresRuntimeVideoCheck: boolean;
  [k: string]: unknown;
}
export interface MediaProbe {
  audioStreams: AudioStream[];
  bitRate: number | null;
  containerFormats: string[];
  durationMs: number | null;
  sizeBytes: number | null;
  subtitleStreams: SubtitleStream[];
  videoStreams: VideoStream[];
  [k: string]: unknown;
}
export interface AudioStream {
  channels: number | null;
  codecName: string;
  durationMs: number | null;
  index: number;
  sampleRateHz: number | null;
  [k: string]: unknown;
}
export interface SubtitleStream {
  codecName: string;
  index: number;
  kind: "text" | "image" | "unknown";
  language: string | null;
  [k: string]: unknown;
}
export interface VideoStream {
  codecName: string;
  durationMs: number | null;
  frameRate: number | null;
  height: number;
  index: number;
  pixelFormat: string | null;
  profile: string | null;
  width: number;
  [k: string]: unknown;
}
export interface MediaArtifact {
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  path: string;
  profile: string;
  projectId: string;
  sourceMediaId: string;
  sourceSha256: string;
  status: MediaArtifactStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
