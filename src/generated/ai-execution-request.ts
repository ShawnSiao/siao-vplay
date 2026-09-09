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

export interface PreviewAiExecutionInput {
  authorization: AiMaterialAuthorization;
  execution: AiExecutionTarget;
  [k: string]: unknown;
}
export interface AiMaterialAuthorization {
  currentQuestion: boolean;
  frames: boolean;
  serviceRevision: number | null;
  subtitles: boolean;
  [k: string]: unknown;
}
