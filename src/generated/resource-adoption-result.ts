/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface ResourceAdoptionResult {
  adoptedResourceIds: string[];
  alreadyActiveResourceIds: string[];
  planFingerprint: string;
  rejectedResourceIds: string[];
  requestId: string;
  resourceRoot: string;
  reusableBytes: number;
  [k: string]: unknown;
}
