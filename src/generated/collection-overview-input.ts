/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface CollectionOverviewInput {
  expectedSnapshotToken: string | null;
  offset: number;
  query: string;
  rootLinked: boolean;
  [k: string]: unknown;
}
