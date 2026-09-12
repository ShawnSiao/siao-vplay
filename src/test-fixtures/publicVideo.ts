import type { YouTubeMediaPreview } from "../types";

export const youtubePreview: YouTubeMediaPreview = {
  originalUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  webpageUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  videoId: "jNQXAC9IVRw",
  title: "Me at the zoo",
  durationSeconds: 19,
  fileSizeBytes: 533_067,
  importerVersion: "2026.08.19",
  importerSha256: "3".repeat(64),
  previewToken: "d".repeat(64),
};


export function directVideoFixture(project: import("../types").Project) {
const remotePreview: import("../types").RemoteMediaPreview = {
  originalUrl: "https://media.example.com/rain-platform.mp4",
  finalUrl: "https://cdn.example.com/rain-platform.mp4",
  displayName: "rain-platform.mp4",
  mediaKind: "direct_file",
  contentType: "video/mp4",
  contentLength: 12_500_000,
  previewToken: "c".repeat(64),
};

const remoteProject: import("../types").Project = {
  ...project,
  id: "171f95a8-938c-4d0c-887b-e4c626f27c70",
  mediaSource: {
    ...project.mediaSource,
    id: "29645135-bcb4-4f56-b4c7-3ec1bf59cd28",
    locator: "W:\\SiaoVPlay\\app-data\\remote-media\\import-1\\source.mp4",
    originUrl: remotePreview.originalUrl,
  },
};

  return { remotePreview, remoteProject };
}
