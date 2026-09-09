/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SearchResultKind = "collection" | "episode" | "unclassified";

export interface SearchResult {
  collectionId: string | null;
  episodeNumber: number | null;
  kind: SearchResultKind;
  projectId: string | null;
  seasonNumber: number | null;
  subtitle: string | null;
  title: string;
  [k: string]: unknown;
}
