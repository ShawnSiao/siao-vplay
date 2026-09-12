/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface LocalResourceCatalog {
  bundlePolicy: BundlePolicy;
  capabilities: CapabilityDefinition[];
  packageProfile: string;
  productId: string;
  profiles: ProfileDefinition[];
  resources: ResourceDefinition[];
  schemaVersion: number;
  updatedAt: string;
  [k: string]: unknown;
}
export interface BundlePolicy {
  allowlistedResourceIds: string[];
  maximumExceptionBytes: number;
  [k: string]: unknown;
}
export interface CapabilityDefinition {
  id: string;
  profileIds: string[];
  requiresCapabilityIds: string[];
  resourceIds: string[];
  title: string;
  [k: string]: unknown;
}
export interface ProfileDefinition {
  id: string;
  recommended: boolean;
  resourceIds: string[];
  title: string;
  [k: string]: unknown;
}
export interface ResourceDefinition {
  artifact: ResourceArtifact | null;
  bundled: boolean;
  distribution: ResourceDistribution | null;
  entrypoints: {
    [k: string]: string;
  };
  expectedDownloadSize: number | null;
  healthCheck: string;
  id: string;
  installedSize: number | null;
  kind: string;
  license: string;
  patchSha256: string | null;
  platform: string;
  requires: string | null;
  sourceCommit: string | null;
  sourcePage: string;
  version: string;
  [k: string]: unknown;
}
export interface ResourceArtifact {
  format: string;
  sha256: string;
  size: number;
  stripComponents: number | null;
  url: string;
  [k: string]: unknown;
}
export interface ResourceDistribution {
  status: string;
  [k: string]: unknown;
}
