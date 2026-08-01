import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LibraryCollection,
  LibraryHome,
  LibrarySearchResult,
} from "../../types";

const gatewayMocks = vi.hoisted(() => ({
  getLibraryHome: vi.fn(),
  searchLibrary: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  getCollectionDetail: vi.fn(),
  listCollectionEpisodes: vi.fn(),
  addProjectToCollection: vi.fn(),
  removeProjectFromCollection: vi.fn(),
  getEpisodeNeighbors: vi.fn(),
  setWatchLater: vi.fn(),
}));

vi.mock("../../lib/desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/desktop")>()),
  commandError: (error: unknown) => ({ code: "test_error", message: String(error) }),
}));

vi.mock("./libraryGateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./libraryGateway")>()),
  ...gatewayMocks,
}));

import { useLibraryController } from "./useLibraryController";

function libraryHome(totalProjectCount: number): LibraryHome {
  return {
    continueWatching: [],
    collections: [],
    folders: [],
    unclassified: [],
    totalProjectCount,
    collectionItemCount: 0,
    unclassifiedCount: totalProjectCount,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const collection: LibraryCollection = {
  id: "10c4a3b9-75ac-4faf-8672-1c86c7a849cb",
  kind: "manual",
  title: "周末电影",
  rootId: null,
  systemKey: null,
  posterPath: null,
  sortMode: "manual",
  autoPlayNext: false,
  lastOpenedAtMs: null,
  createdAtMs: 1,
  updatedAtMs: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  gatewayMocks.searchLibrary.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLibraryController", () => {
  it("ignores a late home response after a newer refresh completes", async () => {
    const first = deferred<LibraryHome>();
    const second = deferred<LibraryHome>();
    gatewayMocks.getLibraryHome
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(gatewayMocks.getLibraryHome).toHaveBeenCalledTimes(1));
    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await waitFor(() => expect(gatewayMocks.getLibraryHome).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve(libraryHome(2));
      await refreshPromise!;
    });
    expect(result.current.state.home.totalProjectCount).toBe(2);

    await act(async () => {
      first.resolve(libraryHome(1));
      await first.promise;
    });
    expect(result.current.state.home.totalProjectCount).toBe(2);
  });

  it("applies the returned collection before the background refresh", async () => {
    const backgroundRefresh = deferred<LibraryHome>();
    gatewayMocks.getLibraryHome
      .mockResolvedValueOnce(libraryHome(0))
      .mockImplementationOnce(() => backgroundRefresh.promise);
    gatewayMocks.createCollection.mockResolvedValue(collection);

    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    await act(async () => {
      await result.current.createManualCollection(collection.title);
    });

    expect(result.current.state.home.collections[0]).toMatchObject({
      id: collection.id,
      title: collection.title,
    });
    expect(gatewayMocks.getLibraryHome).toHaveBeenCalledTimes(2);

    await act(async () => {
      backgroundRefresh.resolve({
        ...libraryHome(0),
        collections: [
          {
            ...collection,
            itemCount: 0,
            seasonCount: 0,
            watchedCount: 0,
            totalDurationMs: null,
          },
        ],
      });
      await backgroundRefresh.promise;
    });
  });

  it("keeps only results for the latest debounced search", async () => {
    vi.useFakeTimers();
    gatewayMocks.getLibraryHome.mockResolvedValue(libraryHome(0));
    const first = deferred<LibrarySearchResult[]>();
    const second = deferred<LibrarySearchResult[]>();
    gatewayMocks.searchLibrary
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useLibraryController());

    act(() => result.current.setSearchQuery("旧结果"));
    await act(async () => vi.advanceTimersByTimeAsync(180));
    act(() => result.current.setSearchQuery("新结果"));
    await act(async () => vi.advanceTimersByTimeAsync(180));

    const newResult: LibrarySearchResult = {
      kind: "collection",
      title: "新结果",
      subtitle: "合集",
      collectionId: collection.id,
      projectId: null,
      seasonNumber: null,
      episodeNumber: null,
    };
    await act(async () => {
      second.resolve([newResult]);
      await second.promise;
    });
    await act(async () => {
      first.resolve([]);
      await first.promise;
    });
    expect(result.current.state.searchResults).toEqual([newResult]);
  });
});
