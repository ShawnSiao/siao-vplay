/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type AiExecutionTarget =
  | {
      kind: "manual";
      [k: string]: unknown;
    }
  | {
      kind: "codex";
      [k: string]: unknown;
    }
  | {
      kind: "api";
      modelId: string;
      serviceConfigId: string;
      [k: string]: unknown;
    };
export type TaskDomain = "explanation" | "learning";

export interface TaskDispatchPreview {
  authorization: AiMaterialAuthorization;
  confirmationSha256: string;
  endpoint: string | null;
  execution: AiExecutionTarget;
  frames: DispatchFrame[];
  model: string;
  playbackCutoffMs: number;
  prompt: DispatchPrompt | null;
  receiver: string;
  selectedText: string | null;
  subtitleCount: number;
  subtitles: DispatchSubtitle[];
  taskId: string;
  taskKind: TaskDomain;
  [k: string]: unknown;
}
export interface AiMaterialAuthorization {
  currentQuestion: boolean;
  frames: boolean;
  serviceRevision: number | null;
  subtitles: boolean;
  [k: string]: unknown;
}
export interface DispatchFrame {
  id: string;
  sha256: string;
  timestampMs: number;
  [k: string]: unknown;
}
export interface DispatchPrompt {
  oneTimeRequirements: string;
  requirements: string;
  template: string;
  [k: string]: unknown;
}
export interface DispatchSubtitle {
  language: string;
  role: string;
  versionId: string;
  versionNumber: number;
  [k: string]: unknown;
}
