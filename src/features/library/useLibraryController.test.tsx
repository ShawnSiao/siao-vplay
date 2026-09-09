import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LibraryImportResult,
  LibraryHome,
  LibraryRescanPreview,
  LibraryRescanResult,
  LibraryRootRelocationPreview,
  LibraryScanPreview,
  LibrarySearchResult,
} from "../../types";
import {
  collection,
  importedDetail,
  libraryHome,
  mediaSummary,
  scanPreview,
} from "./libraryControllerTestFixtures";

const gatewayMocks = vi.hoisted(() => ({
  getLibraryHome: vi.fn(),
  listLibrarySection: vi.fn(),
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
  inspectLibraryRootRebuild: vi.fn(),
  applyLibraryRootRebuild: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  gatewayMocks.searchLibrary.mockResolvedValue([]);
  gatewayMocks.listLibrarySection.mockResolvedValue({
    items: [],
    totalCount: 0,
    nextOffset: null,
  });
  gatewayMocks.listenLibraryScanProgress.mockResolvedValue(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLibraryController", () => {
  it("restores a valid section and appends paged media without duplicates", async () => {
    window.localStorage.setItem("siaovplay-library-section", "watch_later");
    gatewayMocks.getLibraryHome.mockResolvedValue(libraryHome(0));
    gatewayMocks.listLibrarySection
      .mockResolvedValueOnce({
        items: [mediaSummary("first")],
        totalCount: 2,
        nextOffset: 1,
      })
      .mockResolvedValueOnce({
        items: [mediaSummary("first"), mediaSummary("second")],
        totalCount: 2,
        nextOffset: null,
      });
    const { result } = renderHook(() => useLibraryController());

    await waitFor(() =>
      expect(result.current.state.sectionPages.watch_later.items).toHaveLength(1),
    );
    expect(result.current.state.section).toBe("watch_later");
    await act(async () => {
      await result.current.loadMoreSection("watch_later");
    });
    expect(
      result.current.state.sectionPages.watch_later.items.map((item) => item.projectId),
    ).toEqual(["first", "second"]);
    expect(result.current.state.sectionPages.watch_later.nextOffset).toBeNull();
  });

  it("persists section selection and rejects an unknown stored section", async () => {
    window.localStorage.setItem("siaovplay-library-section", "unknown");
    gatewayMocks.getLibraryHome.mockResolvedValue(libraryHome(0));
    const { result } = renderHook(() => useLibraryController());
    expect(result.current.state.section).toBe("home");

    act(() => result.current.setSection("folders"));
    expect(window.localStorage.getItem("siaovplay-library-section")).toBe("folders");
  });

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
      preview,
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
  it("passes the confirmed relocation preview when applying", async () => {
    const preview = { previewToken: "token", rootId: "root", currentRootPath: "W:\\Old", newRootPath: "W:\\Moved", matchedItemCount: 1, mismatches: [], expiresAtMs: 1_900_000_000_000 };
    gatewayMocks.inspectLibraryRootRelocation.mockResolvedValue(preview);
    gatewayMocks.applyLibraryRootRelocation.mockResolvedValue({ root: { id: "root", path: "W:\\Moved", displayName: "Moved", availability: "available", status: "linked", lastScannedAtMs: 1, itemCount: 1 }, updatedItemCount: 1 });
    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    await act(async () => { await result.current.inspectRootRelocation("root", "W:\\Moved"); });
    await act(async () => { await result.current.applyRootRelocation(); });
    expect(gatewayMocks.applyLibraryRootRelocation).toHaveBeenCalledWith(preview);
  });
  it("passes the confirmed rebuild preview when applying", async () => {
    const preview = { previewToken: "token", rootId: "root", currentRootPath: "W:\\Old", rootPath: "W:\\Moved", rootDisplayName: "Moved", suggestedCollectionTitle: "Rain", rootOffline: false, newCandidates: [], matchedItems: [], missingItems: [], changedItems: [], uncertainItems: [], ignoredCount: 0, expiresAtMs: 1_900_000_000_000 };
    gatewayMocks.inspectLibraryRootRebuild.mockResolvedValue(preview);
    gatewayMocks.applyLibraryRootRebuild.mockRejectedValue(new Error("test failure"));
    const { result } = renderHook(() => useLibraryController());
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    await act(async () => { await result.current.inspectRootRebuild("root"); });
    await act(async () => { await result.current.applyRebuild(); });
    expect(gatewayMocks.applyLibraryRootRebuild).toHaveBeenCalledWith(expect.objectContaining({ previewToken: "token" }), preview);
  });
});
