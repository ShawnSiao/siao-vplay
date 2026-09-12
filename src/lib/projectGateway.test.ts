import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
import { getProject, markProjectOpened, updatePlaybackState, ensureProjectPoster, relinkProjectMedia, openLocalProject, createLocalProject, importRemoteMediaUrl } from "./desktop";
import { importYouTubeUrl } from "./publicVideoGateway";
import { setProjectWatched } from "../features/library/libraryGateway";
const project = {
  id: "project", title: "video", status: "ready", revision: 1, createdAtMs: 1, updatedAtMs: 1, lastOpenedAtMs: 1,
  mediaSource: { id: "source", kind: "local_file", locator: "W:/video.mp4", originUrl: null, displayName: "video.mp4", isAvailable: true, sourceSha256: null, probedAtMs: null, posterPath: null, createdAtMs: 1, updatedAtMs: 1 },
  playbackState: { positionMs: 0, durationMs: null, completedAtMs: null, volume: 1, playbackRate: 1, subtitleMode: "bilingual", updatedAtMs: 1 },
};
beforeEach(() => mocks.invoke.mockReset());
const reads = [
  () => setProjectWatched("project", true),
  () => getProject("project"), () => markProjectOpened("project"), () => ensureProjectPoster("project"),
  () => relinkProjectMedia("project", "W:/video.mp4"),
  () => updatePlaybackState("project", { sessionId: "00000000-0000-4000-8000-000000000001", saveSequence: 1, positionMs: 0, durationMs: null, volume: 1, playbackRate: 1, subtitleMode: "bilingual" }),
];
it.each(reads)("rejects another project's response", async read => {
  mocks.invoke.mockResolvedValue({ ...project, id: "other" });
  await expect(read()).rejects.toThrow();
});
it.each([{}, { ...project, revision: 0 }, { ...project, playbackState: { ...project.playbackState, volume: 2 } }, { ...project, mediaSource: { ...project.mediaSource, id: " " } }])("rejects malformed project data", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getProject("project")).rejects.toThrow();
});
it.each(reads)("preserves valid project responses", async read => {
  mocks.invoke.mockResolvedValue(project);
  await expect(read()).resolves.toEqual(project);
});
it("preserves an offline project's recoverable state", async () => {
  const offline = { ...project, status: "needs_relink", mediaSource: { ...project.mediaSource, isAvailable: false } };
  mocks.invoke.mockResolvedValue(offline);
  await expect(getProject("project")).resolves.toEqual(offline);
});
it.each([
  () => importYouTubeUrl("https://example.com/video", "preview", "operation", null),
  () => openLocalProject("W:/video.mp4"), () => createLocalProject("W:/video.mp4"),
  () => importRemoteMediaUrl("https://example.com/video.mp4", "preview", "operation"),
])("validates newly opened or imported projects without assuming their new ID", async create => {
  mocks.invoke.mockResolvedValueOnce({}).mockResolvedValueOnce({ ...project, id: "new-project" });
  await expect(create()).rejects.toThrow();
  await expect(create()).resolves.toEqual({ ...project, id: "new-project" });
});
