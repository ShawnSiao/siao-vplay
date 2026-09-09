/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface ResourceAdoptionResult {
  adoptedResourceIds: string[];
  alreadyActiveResourceIds: string[];
  rejectedResourceIds: string[];
  reusableBytes: number;
  [k: string]: unknown;
}
