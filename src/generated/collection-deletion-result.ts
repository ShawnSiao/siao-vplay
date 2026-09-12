/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type LibraryRootStatus = "linked" | "orphaned" | "ambiguous";

export interface LibraryCollectionDeletionResult {
  collectionId: string;
  preservedProjectCount: number;
  rootId: string | null;
  rootStatus: LibraryRootStatus | null;
  [k: string]: unknown;
}
