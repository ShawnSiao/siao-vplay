/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface ResourceMigrationPreview {
  candidates: ResourceMigrationCandidate[];
  rejectedCount: number;
  reusableBytes: number;
  sources: ResourceMigrationSource[];
  verifiedResourceIds: string[];
  [k: string]: unknown;
}
export interface ResourceMigrationCandidate {
  message: string | null;
  resourceId: string;
  resourcePath: string;
  reusableBytes: number;
  sourceKind: string;
  sourceRoot: string;
  state: string;
  [k: string]: unknown;
}
export interface ResourceMigrationSource {
  kind: string;
  path: string;
  [k: string]: unknown;
}
