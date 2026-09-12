/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface AiModelList {
  manualEntryAllowed: boolean;
  models: AiModelInfo[];
  [k: string]: unknown;
}
export interface AiModelInfo {
  capabilitySource: string;
  displayName: string;
  id: string;
  vision: boolean;
  [k: string]: unknown;
}
