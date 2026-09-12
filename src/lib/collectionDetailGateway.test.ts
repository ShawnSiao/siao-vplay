import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { getCollectionDetail, addProjectToCollection, removeProjectFromCollection, setWatchLater } from "../features/library/libraryGateway";
import { importedDetail as detail } from "../features/library/libraryControllerTestFixtures";
beforeEach(() => mocks.invoke.mockReset());
it.each([
  {}, { ...detail, summary: { ...detail.summary, id: "wrong" } },
  { ...detail, seasons: [{ ...detail.seasons[0], episodeCount: -1 }] },
  { ...detail, seasons: [detail.seasons[0], detail.seasons[0]] },
  { ...detail, summary: { ...detail.summary, watchedCount: 2 } },
  { ...detail, seasons: [{ ...detail.seasons[0], watchedCount: 2 }] },
])("rejects malformed or unrelated collection details", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getCollectionDetail(detail.summary.id)).rejects.toThrow();
});
it("accepts membership updates returning the requested collection", async () => {
  mocks.invoke.mockResolvedValue(detail);
  await expect(addProjectToCollection({ collectionId: detail.summary.id, projectId: "p" })).resolves.toEqual(detail);
  await expect(removeProjectFromCollection(detail.summary.id, "p")).resolves.toEqual(detail);
});
it("validates the collection returned by membership changes", async () => {
  mocks.invoke.mockResolvedValue({ ...detail, summary: { ...detail.summary, id: "wrong" } });
  await expect(addProjectToCollection({ collectionId: detail.summary.id, projectId: "p" })).rejects.toThrow();
  await expect(removeProjectFromCollection(detail.summary.id, "p")).rejects.toThrow();
});
it("requires watch-later results to identify the system collection", async () => {
  mocks.invoke.mockResolvedValue(detail);
  await expect(setWatchLater("p", true)).rejects.toThrow();
  mocks.invoke.mockResolvedValue(null);
  await expect(setWatchLater("p", true)).rejects.toThrow();
  await expect(setWatchLater("p", false)).resolves.toBeNull();
});
it("accepts current details and confirmed system collection", async () => {
  mocks.invoke.mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, summary: { ...detail.summary, systemKey: "watch_later" } });
  await expect(getCollectionDetail(detail.summary.id)).resolves.toEqual(detail);
  await expect(setWatchLater("p", true)).resolves.toMatchObject({ summary: { systemKey: "watch_later" } });
});
