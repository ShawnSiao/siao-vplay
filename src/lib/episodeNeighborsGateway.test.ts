import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { getEpisodeNeighbors } from "../features/library/libraryGateway";
const next = { projectId: "next", displayTitle: "下一集", seasonNumber: 1, episodeNumber: 2, absoluteOrder: 1 };
const wrap = (neighbors: unknown, projectId = "current") => ({ collectionId: "collection", projectId, neighbors });
beforeEach(() => mocks.invoke.mockReset());
it.each([{}, { previous: null, next: {} }, { previous: null, next: { ...next, projectId: "current" } },
  { previous: next, next }, { previous: null, next: { ...next, projectId: " " } },
  { previous: null, next: { ...next, absoluteOrder: -1 } },
])("rejects invalid neighbor targets", async value => {
  mocks.invoke.mockResolvedValue(wrap(value));
  await expect(getEpisodeNeighbors("collection", "current")).rejects.toThrow();
});
it("accepts boundaries and cross-season neighbors", async () => {
  const value = { previous: { ...next, projectId: "previous", seasonNumber: 1 }, next: { ...next, seasonNumber: 2 } };
  mocks.invoke.mockResolvedValueOnce(wrap(value)).mockResolvedValueOnce(wrap({ previous: null, next: null }, "single"));
  await expect(getEpisodeNeighbors("collection", "current")).resolves.toEqual(value);
  await expect(getEpisodeNeighbors("collection", "single")).resolves.toEqual({ previous: null, next: null });
});
it.each([
  { ...wrap({ previous: null, next }), collectionId: "other" },
  wrap({ previous: null, next }, "other"),
  { previous: null, next },
])("rejects missing or unrelated response identity", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getEpisodeNeighbors("collection", "current")).rejects.toThrow();
});
