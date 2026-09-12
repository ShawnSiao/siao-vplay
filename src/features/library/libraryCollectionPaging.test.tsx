import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { importedDetail, libraryHome, mediaSummary, scanPreview } from "./libraryControllerTestFixtures";
import { useLibraryController } from "./useLibraryController";
const mocks = vi.hoisted(() => ({ getLibraryHome: vi.fn(), getCollectionDetail: vi.fn(), listCollectionEpisodes: vi.fn(),
  scanLibraryFolder: vi.fn(), confirmLibraryImport: vi.fn(), inspectLibraryRootRebuild: vi.fn(), applyLibraryRootRebuild: vi.fn(),
  listCollectionEpisodePage: vi.fn(), setProjectWatched: vi.fn(), listLibrarySection: vi.fn(), listenLibraryScanProgress: vi.fn() }));
vi.mock("./libraryGateway", async original => ({ ...(await original<typeof import("./libraryGateway")>()), ...mocks }));
const first = mediaSummary("first"), second = mediaSummary("second");
const page = (items = [first], nextOffset: number | null = 1) => ({ items, totalCount: 2, nextOffset, snapshotToken: "a".repeat(64) });
beforeEach(() => {
  vi.resetAllMocks(); window.localStorage.clear();
  mocks.getLibraryHome.mockResolvedValue(libraryHome(2));
  mocks.getCollectionDetail.mockResolvedValue(importedDetail);
  mocks.listCollectionEpisodes.mockResolvedValue([first, second]);
  mocks.listCollectionEpisodePage.mockResolvedValue(page());
  mocks.listLibrarySection.mockResolvedValue({ items: [], totalCount: 0, nextOffset: null });
  mocks.listenLibraryScanProgress.mockResolvedValue(() => undefined);
});
async function open() {
  const view = renderHook(() => useLibraryController());
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  await act(async () => { await view.result.current.openCollection(importedDetail.summary.id); });
  return view;
}
it.each([1000, 10000])("retains at most24 collection rows after paging through %i items", async total => {
  mocks.listCollectionEpisodePage.mockImplementation(async (_id: string, _season: unknown, offset: number) => ({
    ...page(), totalCount: total, nextOffset: offset + 24 < total ? offset + 24 : null,
    items: Array.from({ length: Math.min(24, total - offset) }, (_, index) => mediaSummary(`item-${offset + index}`)),
  }));
  const { result } = await open();
  while (result.current.collectionPagination.nextOffset !== null) {
    await act(async () => { await result.current.collectionPagination.loadMore(); });
    expect(result.current.state.currentEpisodes.length).toBeLessThanOrEqual(24);
  }
  expect(result.current.state.currentEpisodes.at(-1)?.projectId).toBe(`item-${total - 1}`);
});
it("opens only the first backend page", async () => {
  const { result } = await open();
  expect(mocks.listCollectionEpisodes).not.toHaveBeenCalled();
  expect(result.current.state.currentEpisodes).toEqual([first]);
  expect(result.current.collectionPagination.nextOffset).toBe(1);
});
it("serializes page reads and preserves watched updates while replacing the visible page", async () => {
  const { result } = await open();
  let resolve!: (value: ReturnType<typeof page>) => void;
  mocks.listCollectionEpisodePage.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => { result.current.collectionPagination.loadMore(); result.current.collectionPagination.loadMore(); });
  expect(mocks.listCollectionEpisodePage).toHaveBeenCalledTimes(2);
  mocks.setProjectWatched.mockResolvedValue({ id: "first", playbackState: { completedAtMs: 99 } });
  await act(async () => { await result.current.changeWatched("first", true); });
  expect(result.current.state.currentEpisodes).toEqual([{ ...first, completedAtMs: 99 }]);
  await act(async () => { resolve(page([second], null)); });
  expect(result.current.state.currentEpisodes).toEqual([second]);
  expect(result.current.state.currentCollection?.summary.watchedCount).toBe(1);
  expect(result.current.collectionPagination.nextOffset).toBeNull();
  mocks.listCollectionEpisodePage.mockResolvedValueOnce(page([{ ...first, completedAtMs: 99 }]));
  await act(async () => { await result.current.collectionPagination.loadPrevious?.(); });
  expect(result.current.state.currentEpisodes).toEqual([{ ...first, completedAtMs: 99 }]);
});
it("keeps rows and retries the same cursor after failure", async () => {
  const { result } = await open();
  mocks.listCollectionEpisodePage.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await result.current.collectionPagination.loadMore(); });
  expect(result.current.state.currentEpisodes).toEqual([first]);
  expect(result.current.collectionPagination.error).toContain("offline");
  mocks.listCollectionEpisodePage.mockResolvedValueOnce(page([second], null));
  await act(async () => { await result.current.collectionPagination.loadMore(); });
  expect(mocks.listCollectionEpisodePage).toHaveBeenLastCalledWith(importedDetail.summary.id, null, 1, "a".repeat(64));
  expect(result.current.state.currentEpisodes).toEqual([second]);
});
it("uses the backend page span when returning to the previous page", async () => {
  mocks.listCollectionEpisodePage.mockImplementation(async (_id: string, _season: unknown, offset: number) => ({
    ...page(), items: [mediaSummary(`p${offset}`)], totalCount: 3, nextOffset: offset < 2 ? offset + 1 : null,
  }));
  const { result } = await open();
  await act(async () => { await result.current.collectionPagination.loadMore(); });
  await act(async () => { await result.current.collectionPagination.loadMore(); });
  await act(async () => { await result.current.collectionPagination.loadPrevious?.(); });
  expect(mocks.listCollectionEpisodePage).toHaveBeenLastCalledWith(importedDetail.summary.id, null, 1, "a".repeat(64));
  expect(result.current.state.currentEpisodes[0].projectId).toBe("p1");
});
it("keeps the current page when reading the previous page fails and retries its snapshot", async () => {
  const { result } = await open();
  mocks.listCollectionEpisodePage.mockResolvedValueOnce(page([second], null));
  await act(async () => { await result.current.collectionPagination.loadMore(); });
  mocks.listCollectionEpisodePage.mockRejectedValueOnce(new Error("previous failed"));
  await act(async () => { await result.current.collectionPagination.loadPrevious?.(); });
  expect(result.current.state.currentEpisodes).toEqual([second]);
  expect(result.current.collectionPagination.offset).toBe(1);
  expect(result.current.collectionPagination.error).toContain("previous failed");
  mocks.listCollectionEpisodePage.mockResolvedValueOnce(page());
  await act(async () => { await result.current.collectionPagination.loadPrevious?.(); });
  expect(result.current.state.currentEpisodes).toEqual([first]);
  expect(result.current.collectionPagination.offset).toBe(0);
  expect(mocks.listCollectionEpisodePage).toHaveBeenLastCalledWith(importedDetail.summary.id, null, 0, "a".repeat(64));
});
it("ignores an append after the collection closes", async () => {
  const { result } = await open();
  let resolve!: (value: ReturnType<typeof page>) => void;
  mocks.listCollectionEpisodePage.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => { result.current.collectionPagination.loadMore(); });
  act(() => { result.current.closeCollection(); });
  await act(async () => { resolve(page([second], null)); });
  expect(result.current.state.currentCollection).toBeNull();
  expect(result.current.state.currentEpisodes).toEqual([]);
});

it.each(["snapshot", "duplicate"])("rejects a changed %s and reloads the first page", async kind => {
  const { result } = await open();
  mocks.listCollectionEpisodePage.mockResolvedValueOnce(kind === "snapshot" ? { ...page([second], null), snapshotToken: "b".repeat(64) } : page([first], null));
  await act(async () => { await result.current.collectionPagination.loadMore(); });
  expect(result.current.state.currentEpisodes).toEqual([first]);
  expect(result.current.collectionPagination.error).toContain("合集已变化");
  await act(async () => { result.current.collectionPagination.reload(); });
  expect(mocks.listCollectionEpisodePage).toHaveBeenLastCalledWith(importedDetail.summary.id, null, 0);
  expect(result.current.collectionPagination.error).toBeNull();
});

it.each(["import", "rebuild"])("keeps committed %s successful when its page read fails and retries only the read", async kind => {
  const { result } = await open();
  const detail = { ...importedDetail, summary: { ...importedDetail.summary, id: "new-collection" } };
  const committed = { collection: detail, rootId: "root", root: { id: "root", path: "W:/media", displayName: "media", itemCount: 1 },
    addedItemCount: 1, importedItemCount: 1, createdProjectCount: 1, reusedProjectCount: 0 };
  mocks.getCollectionDetail.mockResolvedValue(detail);
  mocks.listCollectionEpisodePage.mockRejectedValueOnce(new Error("read unavailable"));
  if (kind === "import") {
    mocks.scanLibraryFolder.mockResolvedValue(scanPreview);
    mocks.confirmLibraryImport.mockResolvedValue(committed);
    await act(async () => { await result.current.startFolderScan(scanPreview.rootPath); });
    await act(async () => { expect(await result.current.importScannedFolder()).toBe(committed); });
  } else {
    mocks.inspectLibraryRootRebuild.mockResolvedValue({ previewToken: "token", rootId: "root", currentRootPath: "W:/old", rootPath: "W:/media", rootDisplayName: "media",
      suggestedCollectionTitle: "Rain", rootOffline: false, newCandidates: [], matchedItems: [], missingItems: [], changedItems: [], uncertainItems: [], ignoredCount: 0, expiresAtMs: 1900000000000 });
    mocks.applyLibraryRootRebuild.mockResolvedValue(committed);
    await act(async () => { await result.current.inspectRootRebuild("root"); });
    await act(async () => { expect(await result.current.applyRebuild()).toBe(committed); });
  }
  expect(result.current.state.folderImport.stage).toBe("closed");
  expect(result.current.state.recovery.stage).toBe("closed");
  expect(result.current.state.currentCollection?.summary.id).toBe("new-collection");
  expect(result.current.state.currentEpisodes).toEqual([]);
  expect(result.current.collectionPagination.error).toContain("read unavailable");
  expect(result.current.collectionPagination.nextOffset).toBeNull();
  expect(result.current.state.error).toBeNull();
  await act(async () => { result.current.collectionPagination.reload(); });
  expect(result.current.state.currentEpisodes).toEqual([first]);
  expect(mocks[kind === "import" ? "confirmLibraryImport" : "applyLibraryRootRebuild"]).toHaveBeenCalledOnce();
});

it("does not append a previous season after a new season has loaded", async () => {
  const { result } = await open();
  let resolve!: (value: ReturnType<typeof page>) => void;
  mocks.listCollectionEpisodePage.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => { result.current.collectionPagination.loadMore(); });
  const nextSeason = { ...mediaSummary("season-two"), seasonNumber: 2 };
  mocks.listCollectionEpisodePage.mockResolvedValueOnce(page([nextSeason], null));
  await act(async () => { await result.current.openCollection(importedDetail.summary.id, 2); });
  await act(async () => { resolve(page([second], null)); });
  expect(result.current.state.selectedSeason).toBe(2);
  expect(result.current.state.currentEpisodes).toEqual([nextSeason]);
  const calls = mocks.listCollectionEpisodePage.mock.calls.length;
  await act(async () => { await result.current.collectionPagination.loadMore(); });
  expect(mocks.listCollectionEpisodePage).toHaveBeenCalledTimes(calls);
});
