import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useLibraryController } from "./useLibraryController";
import { importedDetail, libraryHome } from "./libraryControllerTestFixtures";
const mocks = vi.hoisted(() => ({ getLibraryHome: vi.fn(), getCollectionDetail: vi.fn(), listCollectionEpisodePage: vi.fn(), searchLibrary: vi.fn(), removeProjectFromCollection: vi.fn(), listenLibraryScanProgress: vi.fn() }));
vi.mock("./libraryGateway", async original => ({ ...await original<typeof import("./libraryGateway")>(), ...mocks }));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it.each(["collection", "search", "mutation"] as const)("%s failure only clears its own busy state", async failed => {
  vi.resetAllMocks(); localStorage.clear();
  const home = deferred<ReturnType<typeof libraryHome>>();
  const collection = deferred<typeof importedDetail>();
  const search = deferred<never[]>();
  const mutation = deferred<typeof importedDetail>();
  mocks.getLibraryHome.mockResolvedValueOnce(libraryHome(0)).mockReturnValue(home.promise);
  mocks.getCollectionDetail.mockReturnValue(collection.promise);
  mocks.listCollectionEpisodePage.mockResolvedValue({ items: [], totalCount: 0, nextOffset: null, snapshotToken: "snapshot" });
  mocks.searchLibrary.mockReturnValue(search.promise);
  mocks.removeProjectFromCollection.mockReturnValue(mutation.promise);
  mocks.listenLibraryScanProgress.mockResolvedValue(() => undefined);
  const hook = renderHook(() => useLibraryController());
  await waitFor(() => expect(hook.result.current.state.loading).toBe(false));
  let operations!: Promise<unknown>[];
  act(() => {
    operations = [hook.result.current.refresh(), hook.result.current.openCollection("collection"), hook.result.current.removeFromCollection("collection", "project")];
    hook.result.current.setSearchQuery("term");
  });
  await waitFor(() => expect(mocks.searchLibrary).toHaveBeenCalled());
  try {
    await act(async () => { ({ collection, search, mutation })[failed].reject(new Error("fixture failure")); });
    expect(hook.result.current.state.loading).toBe(true);
    expect(hook.result.current.state.collectionLoading).toBe(failed !== "collection");
    expect(hook.result.current.state.searchLoading).toBe(failed !== "search");
    expect(hook.result.current.state.mutationPending).toBe(failed !== "mutation");
    expect(hook.result.current.state.error).toContain("fixture failure");
  } finally {
    await act(async () => {
      home.resolve(libraryHome(0)); collection.resolve(importedDetail); search.resolve([]); mutation.resolve(importedDetail);
      await Promise.all(operations);
    });
  }
});
