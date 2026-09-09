/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface ResourceAdoptionResult {
  adoptedResourceIds: string[];
  alreadyActiveResourceIds: string[];
  interruption: ResourceAdoptionInterruption | null;
  planFingerprint: string;
  rejectedResourceIds: string[];
  requestId: string;
  resourceRoot: string;
  reusableBytes: number;
  [k: string]: unknown;
}
export interface ResourceAdoptionInterruption {
  message: string;
  resourceId: string;
  unattemptedResourceIds: string[];
  [k: string]: unknown;
}
