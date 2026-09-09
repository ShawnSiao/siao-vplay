/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface YouTubeMediaPreview {
  durationSeconds: number;
  fileSizeBytes: number | null;
  importerSha256: string;
  importerVersion: string;
  originalUrl: string;
  previewToken: string;
  title: string;
  videoId: string;
  webpageUrl: string;
  [k: string]: unknown;
}
