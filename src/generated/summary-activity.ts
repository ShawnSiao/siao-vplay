/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type TaskStatus =
  | "prepared"
  | "awaiting_external_result"
  | "queued"
  | "running"
  | "paused"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SummaryActivity {
  hasResult: boolean;
  id: string;
  projectId: string;
  projectTitle: string;
  status: TaskStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
