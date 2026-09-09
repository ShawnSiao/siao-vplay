/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface OldResourceVersionCleanupPlan {
  candidates: OldResourceVersionCandidate[];
  confirmationRequired: boolean;
  planFingerprint: string;
  protectedVersions: string[];
  reclaimableBytes: number;
  [k: string]: unknown;
}
export interface OldResourceVersionCandidate {
  reclaimableBytes: number;
  resourceId: string;
  version: string;
  [k: string]: unknown;
}
