/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type RemoteMediaKind = "direct_file" | "hls";

export interface RemoteMediaPreview {
  contentLength: number | null;
  contentType: string | null;
  displayName: string;
  finalUrl: string;
  mediaKind: RemoteMediaKind;
  originalUrl: string;
  previewToken: string;
  [k: string]: unknown;
}
