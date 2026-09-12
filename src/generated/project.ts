/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type MediaSourceKind = "local_file";
export type SubtitleDisplayMode = "original" | "translation" | "bilingual";
export type ProjectStatus = "ready" | "needs_relink";

export interface Project {
  createdAtMs: number;
  id: string;
  lastOpenedAtMs: number;
  mediaSource: MediaSource;
  playbackState: PlaybackState;
  revision: number;
  status: ProjectStatus;
  title: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface MediaSource {
  createdAtMs: number;
  displayName: string;
  id: string;
  isAvailable: boolean;
  kind: MediaSourceKind;
  locator: string;
  originUrl: string | null;
  posterPath: string | null;
  probedAtMs: number | null;
  sourceSha256: string | null;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface PlaybackState {
  completedAtMs: number | null;
  durationMs: number | null;
  playbackRate: number;
  positionMs: number;
  subtitleMode: SubtitleDisplayMode;
  updatedAtMs: number;
  volume: number;
  [k: string]: unknown;
}
