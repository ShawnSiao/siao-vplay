import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { listCollectionEpisodes } from "../features/library/libraryGateway";
import { mediaSummary } from "../features/library/libraryControllerTestFixtures";
const item = { ...mediaSummary("p"), collectionId: "c", seasonNumber: 1 };
beforeEach(() => mocks.invoke.mockReset());
it.each([{}, [null], [item, item], [{ ...item, collectionId: "other" }], [{ ...item, seasonNumber: 2 }], [{ ...item, projectId: " " }]])("rejects unrelated or invalid episode rows", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(listCollectionEpisodes("c", 1)).rejects.toThrow();
});
it("accepts all seasons when no season filter is requested", async () => {
  const rows = [item, { ...item, projectId: "p2", seasonNumber: 2 }, { ...item, projectId: "p3", seasonNumber: null }];
  mocks.invoke.mockResolvedValue(rows);
  await expect(listCollectionEpisodes("c", null)).resolves.toEqual(rows);
});
it("accepts a selected season and an empty collection", async () => {
  mocks.invoke.mockResolvedValueOnce([item]).mockResolvedValueOnce([]);
  await expect(listCollectionEpisodes("c", 1)).resolves.toEqual([item]);
  await expect(listCollectionEpisodes("c", null)).resolves.toEqual([]);
});
