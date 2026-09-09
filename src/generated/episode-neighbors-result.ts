/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface EpisodeNeighborsResult {
  collectionId: string;
  neighbors: EpisodeNeighbors;
  projectId: string;
  [k: string]: unknown;
}
export interface EpisodeNeighbors {
  next: EpisodeReference | null;
  previous: EpisodeReference | null;
  [k: string]: unknown;
}
export interface EpisodeReference {
  absoluteOrder: number;
  displayTitle: string;
  episodeNumber: number | null;
  projectId: string;
  seasonNumber: number | null;
  [k: string]: unknown;
}
