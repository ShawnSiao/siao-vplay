/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type RootAvailability = "available" | "offline";
export type LibraryRootStatus = "linked" | "orphaned" | "ambiguous";

export interface LibraryRootRelocationResult {
  root: LibraryRootSummary;
  updatedItemCount: number;
  [k: string]: unknown;
}
export interface LibraryRootSummary {
  availability: RootAvailability;
  displayName: string;
  id: string;
  itemCount: number;
  lastScannedAtMs: number | null;
  path: string;
  status: LibraryRootStatus;
  [k: string]: unknown;
}
