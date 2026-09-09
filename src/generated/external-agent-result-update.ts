/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type ExternalAgentResultStatus = "validating" | "completed" | "rejected";
export type ExternalAgentTaskKind = "translation" | "explanation" | "learning";

export interface ExternalAgentResultUpdate {
  message: string;
  outputId: string | null;
  projectId: string;
  status: ExternalAgentResultStatus;
  taskId: string;
  taskKind: ExternalAgentTaskKind;
  [k: string]: unknown;
}
