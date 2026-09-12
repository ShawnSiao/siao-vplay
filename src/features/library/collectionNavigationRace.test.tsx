import { setupLibraryQueryMocks } from "../../test/libraryQueryMocks";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { importedDetail, libraryHome, mediaSummary } from "./libraryControllerTestFixtures";
import { useLibraryController } from "./useLibraryController";
const mocks = vi.hoisted(() => ({ getLibraryHome: vi.fn(), getCollectionDetail: vi.fn(), listCollectionEpisodes: vi.fn(), listCollectionEpisodePage: vi.fn(),
  listLibrarySection: vi.fn(), listenLibraryScanProgress: vi.fn() }));
vi.mock("./libraryGateway", async original => ({ ...(await original<typeof import("./libraryGateway")>()), ...mocks }));
beforeEach(() => {
  vi.clearAllMocks();
  setupLibraryQueryMocks(mocks);
  window.localStorage.clear();
  mocks.getLibraryHome.mockResolvedValue(libraryHome(0));
  mocks.listCollectionEpisodes.mockResolvedValue([]);
  mocks.listLibrarySection.mockResolvedValue({ items: [], totalCount: 0, nextOffset: null });
  mocks.listenLibraryScanProgress.mockResolvedValue(() => undefined);
});

it.each(["close", "section"].flatMap(action => ["success", "failure"].map(outcome => ({ action, outcome }))))("ignores late $outcome after $action", async ({ action, outcome }) => {
    let resolve!: (value: typeof importedDetail) => void;
    let reject!: (error: Error) => void;
    mocks.getCollectionDetail.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => { pending = result.current.openCollection(importedDetail.summary.id); });
    expect(result.current.state.collectionLoading).toBe(true);
    act(() => {
      if (action === "close") result.current.closeCollection();
      else result.current.setSection("home");
    });
    expect(result.current.state.collectionLoading).toBe(false);
    await act(async () => {
      if (outcome === "success") resolve(importedDetail); else reject(new Error("late failure"));
      await pending;
    });
    expect(result.current.state.currentCollection).toBeNull();
    expect(result.current.state.currentEpisodes).toEqual([]);
    expect(result.current.state.error).toBeNull();
  });


it("keeps the committed season and rows together when a new season fails, then retries", async () => {
  mocks.getCollectionDetail.mockResolvedValue(importedDetail);
  const first = { ...mediaSummary("first"), seasonNumber: 1 };
  const second = { ...mediaSummary("second"), seasonNumber: 2 };
  mocks.listCollectionEpisodes.mockResolvedValueOnce([first]);
  const { result } = renderHook(() => useLibraryController());
  await waitFor(() => expect(result.current.state.loading).toBe(false));
  await act(async () => { await result.current.openCollection(importedDetail.summary.id, 1); });
  mocks.listCollectionEpisodes.mockRejectedValueOnce(new Error("season unavailable"));
  await act(async () => { await result.current.openCollection(importedDetail.summary.id, 2); });
  expect(result.current.state.selectedSeason).toBe(1);
  expect(result.current.state.currentEpisodes).toEqual([first]);
  expect(result.current.state.error).toContain("season unavailable");
  mocks.listCollectionEpisodes.mockResolvedValueOnce([second]);
  await act(async () => { await result.current.openCollection(importedDetail.summary.id, 2); });
  expect(result.current.state.selectedSeason).toBe(2);
  expect(result.current.state.currentEpisodes).toEqual([second]);
  expect(result.current.state.error).toBeNull();
});
