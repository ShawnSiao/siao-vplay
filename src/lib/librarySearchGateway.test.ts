import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { searchLibrary } from "../features/library/libraryGateway";
const episode = { kind: "episode", title: "视频", subtitle: "合集", collectionId: "c", projectId: "p", seasonNumber: 1, episodeNumber: 2 };
beforeEach(() => mocks.invoke.mockReset());
it.each([
  {}, [null], [{ ...episode, kind: "unknown" }], [{ ...episode, projectId: null }],
  [{ ...episode, collectionId: " " }], [{ ...episode, seasonNumber: -1 }],
  [{ ...episode, kind: "collection" }], [{ ...episode, kind: "unclassified" }],
  [episode, episode],
  [{ ...episode, episodeNumber: Number.MAX_SAFE_INTEGER + 1 }],
  [episode, { ...episode, kind: "unclassified", collectionId: null, seasonNumber: null, episodeNumber: null }],
])("rejects invalid search responses", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(searchLibrary("视频")).rejects.toThrow();
});
it("accepts unknown season and episode numbers for a collection member", async () => {
  const value = [{ ...episode, seasonNumber: null, episodeNumber: null }];
  mocks.invoke.mockResolvedValue(value);
  await expect(searchLibrary("视频")).resolves.toEqual(value);
});
it("accepts each supported navigation target and an empty result", async () => {
  const value = [episode,
    { ...episode, kind: "collection", projectId: null, seasonNumber: null, episodeNumber: null },
    { ...episode, kind: "unclassified", collectionId: null, projectId: "other", seasonNumber: null, episodeNumber: null }];
  mocks.invoke.mockResolvedValueOnce(value).mockResolvedValueOnce([]);
  await expect(searchLibrary("视频")).resolves.toEqual(value);
  await expect(searchLibrary("没有匹配")).resolves.toEqual([]);
  expect(mocks.invoke).toHaveBeenNthCalledWith(1, "search_library", { query: "视频" });
});
