/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type ResourceMaintenanceScanState = "not_configured" | "complete" | "partial" | "root_unavailable";
export type ResourceChangeState = "none" | "activation_pending" | "removal_pending" | "conflicting" | "unavailable";

export interface LocalResourceDiagnostics {
  catalogSource: string;
  generatedAtMs: number;
  maintenance: ResourceMaintenanceDiagnostics;
  preferredProfile: string;
  remoteCatalogEnabled: boolean;
  remoteSignaturePolicy: string;
  resourceRoot: string | null;
  resources: ResourceDiagnosticItem[];
  rootState: string;
  tasks: ResourceTaskDiagnostic[];
  [k: string]: unknown;
}
export interface ResourceMaintenanceDiagnostics {
  receiptRecoveryCopyCount: number;
  scanState: ResourceMaintenanceScanState;
  stagingReviewCount: number;
  transactionState: ResourceChangeState;
  [k: string]: unknown;
}
export interface ResourceDiagnosticItem {
  activeVersion: string | null;
  artifactSha256: string | null;
  artifactUrl: string | null;
  catalogVersion: string;
  healthCheck: string;
  id: string;
  license: string;
  sourcePage: string;
  state: string;
  versions: ResourceVersionDiagnostic[];
  [k: string]: unknown;
}
export interface ResourceVersionDiagnostic {
  activatedAtMs: number | null;
  active: boolean;
  entrypointsAvailable: boolean;
  fileCount: number;
  healthStatus: string;
  installPath: string;
  installedBytes: number;
  manifestSha256: string;
  version: string;
  [k: string]: unknown;
}
export interface ResourceTaskDiagnostic {
  downloadedBytes: number;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  resourceId: string;
  state: string;
  totalBytes: number;
  version: string;
  [k: string]: unknown;
}
