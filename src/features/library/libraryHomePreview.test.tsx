import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { collection, importedDetail, libraryHome } from "./libraryControllerTestFixtures";
const mocks = vi.hoisted(() => ({ getLibraryHome: vi.fn(), createCollection: vi.fn(), updateCollection: vi.fn(), setWatchLater: vi.fn(), listenLibraryScanProgress: vi.fn() }));
vi.mock("./libraryGateway", async original => ({ ...(await original<typeof import("./libraryGateway")>()), ...mocks }));
import { useLibraryController } from "./useLibraryController";
beforeEach(() => { vi.resetAllMocks(); window.localStorage.clear(); mocks.listenLibraryScanProgress.mockResolvedValue(() => {}); });
function home() {
  return { ...libraryHome(10), collectionCount: 1000, folderCount: 10000,
    collections: Array.from({ length: 4 }, (_, i) => ({ ...importedDetail.summary, id: `collection-${i}`, systemKey: null })) };
}
it("bounds optimistic previews and refreshes authoritative totals without guessing off-page membership", async () => {
  const initial = home();
  let resolve!: (value: typeof initial) => void;
  mocks.getLibraryHome.mockResolvedValueOnce(initial).mockImplementation(() => new Promise<typeof initial>(done => { resolve = done; }));
  mocks.updateCollection.mockResolvedValue({ ...collection, id: "off-page", title: "Renamed" });
  const { result } = renderHook(() => useLibraryController());
  await waitFor(() => expect(result.current.state.home.collectionCount).toBe(1000));
  await act(async () => { await result.current.editCollection("off-page", { title: "Renamed" }); });
  expect(result.current.state.home.collections).toHaveLength(4);
  expect(result.current.state.home.collections[0].id).toBe("off-page");
  expect(result.current.state.home.collectionCount).toBe(1000);
  await act(async () => { resolve({ ...initial, collectionCount: 1001 }); });
  await waitFor(() => expect(result.current.state.home.collectionCount).toBe(1001));
});
it("updates watch-later total without inserting a system collection into previews", async () => {
  const initial = home();
  mocks.getLibraryHome.mockResolvedValueOnce(initial).mockImplementation(() => new Promise(() => {}));
  mocks.setWatchLater.mockResolvedValue({ ...importedDetail, summary: { ...importedDetail.summary, systemKey: "watch_later", itemCount: 7 } });
  const { result } = renderHook(() => useLibraryController());
  await waitFor(() => expect(result.current.state.home.collectionCount).toBe(1000));
  await act(async () => { await result.current.changeWatchLater("project", true); });
  expect(result.current.state.home.watchLaterCount).toBe(7);
  expect(result.current.state.home.collections).toEqual(initial.collections);
});
it("keeps last verified totals and exposes refresh failure after a successful edit", async () => {
  const initial = home();
  mocks.getLibraryHome.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("refresh failed"));
  mocks.updateCollection.mockResolvedValue({ ...collection, id: "off-page" });
  const { result } = renderHook(() => useLibraryController());
  await waitFor(() => expect(result.current.state.home.collectionCount).toBe(1000));
  await act(async () => { await result.current.editCollection("off-page", { title: "Renamed" }); });
  await waitFor(() => expect(result.current.state.error).toBeTruthy());
  expect(result.current.state.home.collectionCount).toBe(1000);
  expect(result.current.state.home.collections).toHaveLength(4);
  mocks.getLibraryHome.mockResolvedValue({ ...initial, collectionCount: 999 });
  await act(async () => { await result.current.refresh(); });
  expect(result.current.state.home.collectionCount).toBe(999);
  expect(result.current.state.error).toBeNull();
});
