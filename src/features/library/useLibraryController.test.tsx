import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CollectionDetail,
  LibraryCollection,
  LibraryHome,
  LibraryImportResult,
  LibraryRescanPreview,
  LibraryRescanResult,
  LibraryRootRelocationPreview,
  LibraryScanPreview,
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
  scanLibraryFolder: vi.fn(),
  cancelLibraryScan: vi.fn(),
  listenLibraryScanProgress: vi.fn(),
  confirmLibraryImport: vi.fn(),
  inspectLibraryRescan: vi.fn(),
  applyLibraryRescan: vi.fn(),
  inspectLibraryRootRelocation: vi.fn(),
  applyLibraryRootRelocation: vi.fn(),
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
    recentlyAdded: [],
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

const scanPreview: LibraryScanPreview = {
  scanId: "20000000-0000-4000-8000-000000000001",
  previewToken: "20000000-0000-4000-8000-000000000002",
  rootPath: "W:\\Series\\Rain",
  rootDisplayName: "Rain",
  suggestedCollectionTitle: "Rain",
  candidates: [
    {
      candidateId: "20000000-0000-4000-8000-000000000003",
      relativePath: "Rain.S01E01.mp4",
      displayTitle: "Rain",
      seasonNumber: 1,
      episodeNumber: 1,
      absoluteOrder: 0,
      recognition: "sxx_exx",
      needsConfirmation: false,
      confirmationReason: null,
      sourceSizeBytes: 1024,
      sourceModifiedAtMs: 10,
      quickFingerprint: "a".repeat(64),
    },
  ],
  ignoredEntries: [],
  ignoredCount: 0,
  needsConfirmationCount: 0,
  expiresAtMs: 1_900_000_000_000,
};

const importedDetail: CollectionDetail = {
  summary: {
    ...collection,
    kind: "series",
    title: "Rain",
    rootId: "20000000-0000-4000-8000-000000000004",
    sortMode: "episode",
    itemCount: 1,
    seasonCount: 1,
    watchedCount: 0,
    totalDurationMs: null,
  },
  seasons: [
    {
      seasonNumber: 1,
      episodeCount: 1,
      watchedCount: 0,
      totalDurationMs: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  gatewayMocks.searchLibrary.mockResolvedValue([]);
  gatewayMocks.listenLibraryScanProgress.mockResolvedValue(() => undefined);
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

  it("cancels a scan and ignores its late preview", async () => {
    gatewayMocks.getLibraryHome.mockResolvedValue(libraryHome(0));
    const pendingScan = deferred<LibraryScanPreview>();
    gatewayMocks.scanLibraryFolder.mockImplementation(() => pendingScan.promise);
    gatewayMocks.cancelLibraryScan.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    let scanPromise: Promise<LibraryScanPreview | null>;
    act(() => {
      scanPromise = result.current.startFolderScan(scanPreview.rootPath);
    });
    expect(result.current.state.folderImport.stage).toBe("scanning");
    await act(async () => {
      await result.current.cancelFolderScan();
    });
    expect(result.current.state.folderImport.stage).toBe("closed");
    expect(gatewayMocks.cancelLibraryScan).toHaveBeenCalledOnce();

    await act(async () => {
      pendingScan.resolve(scanPreview);
      await scanPromise!;
    });
    expect(result.current.state.folderImport.stage).toBe("closed");
  });

  it("keeps a confirmed import successful when its secondary episode read fails", async () => {
    const backgroundRefresh = deferred<LibraryHome>();
    gatewayMocks.getLibraryHome
      .mockResolvedValueOnce(libraryHome(0))
      .mockImplementationOnce(() => backgroundRefresh.promise);
    gatewayMocks.scanLibraryFolder.mockResolvedValue(scanPreview);
    const importResult: LibraryImportResult = {
      rootId: importedDetail.summary.rootId!,
      collection: importedDetail,
      importedItemCount: 1,
      createdProjectCount: 1,
      reusedProjectCount: 0,
    };
    gatewayMocks.confirmLibraryImport.mockResolvedValue(importResult);
    gatewayMocks.listCollectionEpisodes.mockRejectedValue(
      new Error("temporary episode read failure"),
    );
    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    await act(async () => {
      await result.current.startFolderScan(scanPreview.rootPath);
    });
    expect(result.current.state.folderImport.stage).toBe("preview");
    await act(async () => {
      await result.current.importScannedFolder();
    });

    expect(gatewayMocks.confirmLibraryImport).toHaveBeenCalledWith(
      expect.objectContaining({
        previewToken: scanPreview.previewToken,
        collectionTitle: "Rain",
        confirmFingerprintDuplicates: false,
      }),
    );
    expect(result.current.state.currentCollection?.summary.title).toBe("Rain");
    expect(result.current.state.home.folders[0]).toMatchObject({
      id: importResult.rootId,
      path: scanPreview.rootPath,
      itemCount: 1,
    });
    expect(result.current.state.folderImport.stage).toBe("closed");
    expect(result.current.state.error).toBeNull();

    await act(async () => {
      backgroundRefresh.resolve({
        ...libraryHome(1),
        collections: [importedDetail.summary],
        folders: result.current.state.home.folders,
        collectionItemCount: 1,
      });
      await backgroundRefresh.promise;
    });
  });

  it("applies a confirmed rescan locally before refreshing the library", async () => {
    const root = {
      id: importedDetail.summary.rootId!,
      path: scanPreview.rootPath,
      displayName: "Rain",
      availability: "available" as const,
      status: "linked" as const,
      lastScannedAtMs: 10,
      itemCount: 1,
    };
    const initialHome = {
      ...libraryHome(1),
      collections: [importedDetail.summary],
      folders: [root],
      collectionItemCount: 1,
      unclassifiedCount: 0,
    };
    const backgroundRefresh = deferred<LibraryHome>();
    gatewayMocks.getLibraryHome
      .mockResolvedValueOnce(initialHome)
      .mockImplementationOnce(() => backgroundRefresh.promise);
    const preview: LibraryRescanPreview = {
      previewToken: "70000000-0000-4000-8000-000000000001",
      rootId: root.id,
      rootPath: root.path,
      rootDisplayName: root.displayName,
      collectionId: importedDetail.summary.id,
      rootOffline: false,
      newCandidates: [{
        ...scanPreview.candidates[0],
        candidateId: "70000000-0000-4000-8000-000000000002",
        relativePath: "Rain.S01E02.mp4",
        episodeNumber: 2,
        absoluteOrder: 1,
      }],
      missingItems: [],
      changedItems: [],
      availableItemCount: 1,
      ignoredCount: 0,
      expiresAtMs: 1_900_000_000_000,
    };
    const rescanResult: LibraryRescanResult = {
      root: { ...root, itemCount: 2, lastScannedAtMs: 20 },
      collection: {
        ...importedDetail,
        summary: { ...importedDetail.summary, itemCount: 2 },
      },
      addedItemCount: 1,
      createdProjectCount: 1,
      reusedProjectCount: 0,
      missingItemCount: 0,
      changedItemCount: 0,
      availableItemCount: 1,
    };
    gatewayMocks.inspectLibraryRescan.mockResolvedValue(preview);
    gatewayMocks.applyLibraryRescan.mockResolvedValue(rescanResult);
    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    await act(async () => {
      await result.current.inspectRootRescan(root.id);
    });
    expect(result.current.state.recovery.stage).toBe("rescan_preview");
    await act(async () => {
      await result.current.applyRescan();
    });

    expect(gatewayMocks.applyLibraryRescan).toHaveBeenCalledWith(
      expect.objectContaining({
        previewToken: preview.previewToken,
        newItems: [expect.objectContaining({ episodeNumber: 2 })],
      }),
    );
    expect(result.current.state.recovery.stage).toBe("closed");
    expect(result.current.state.home.totalProjectCount).toBe(2);
    expect(result.current.state.home.collectionItemCount).toBe(2);
    expect(result.current.state.home.folders[0].itemCount).toBe(2);
    await act(async () => {
      backgroundRefresh.resolve({
        ...initialHome,
        totalProjectCount: 2,
        collectionItemCount: 2,
        folders: [rescanResult.root],
        collections: [rescanResult.collection.summary],
      });
      await backgroundRefresh.promise;
    });
  });

  it("ignores a relocation inspection after its dialog is closed", async () => {
    gatewayMocks.getLibraryHome.mockResolvedValue(libraryHome(0));
    const pending = deferred<LibraryRootRelocationPreview>();
    gatewayMocks.inspectLibraryRootRelocation.mockImplementation(() => pending.promise);
    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    let inspection: Promise<unknown>;
    act(() => {
      inspection = result.current.inspectRootRelocation("root", "W:\\Moved");
    });
    act(() => result.current.closeRecovery());
    await act(async () => {
      pending.resolve({
        previewToken: "70000000-0000-4000-8000-000000000003",
        rootId: "root",
        currentRootPath: "W:\\Old",
        newRootPath: "W:\\Moved",
        matchedItemCount: 1,
        mismatches: [],
        expiresAtMs: 1_900_000_000_000,
      });
      await inspection!;
    });
    expect(result.current.state.recovery.stage).toBe("closed");
  });
});
