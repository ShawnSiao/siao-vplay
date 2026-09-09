import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
import { readProjectList } from "./projectGateway";

const project = {
  id: "project", title: "video", status: "needs_relink", revision: 1, createdAtMs: 1, updatedAtMs: 1, lastOpenedAtMs: 1,
  mediaSource: { id: "source", kind: "local_file", locator: "W:/video.mp4", originUrl: null, displayName: "video.mp4", isAvailable: false, sourceSha256: null, probedAtMs: null, posterPath: null, createdAtMs: 1, updatedAtMs: 1 },
  playbackState: { positionMs: 0, durationMs: null, completedAtMs: null, volume: 1, playbackRate: 1, subtitleMode: "bilingual", updatedAtMs: 1 },
};
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([null, {}, [{}], [project, project], [{ ...project, id: " " }], [{ ...project, mediaSource: { ...project.mediaSource, locator: " " } }]].map(value => ({ value })))("rejects invalid project lists", async ({ value }) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(readProjectList()).rejects.toThrow();
});
it.each([[], [project]].map(value => ({ value })))("preserves empty lists and recoverable offline projects", async ({ value }) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(readProjectList()).resolves.toEqual(value);
  expect(mocks.invoke).toHaveBeenCalledWith("list_projects");
});
