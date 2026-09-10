import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { CollectionDetail } from "../../types";
import { deferred, importedDetail, libraryHome } from "./libraryControllerTestFixtures";
import { useLibraryController } from "./useLibraryController";

const mocks = vi.hoisted(() => ({ getLibraryHome: vi.fn(), getCollectionDetail: vi.fn(), listCollectionEpisodePage: vi.fn(), removeProjectFromCollection: vi.fn(), listenLibraryScanProgress: vi.fn() }));
vi.mock("./libraryGateway", async original => ({ ...await original<typeof import("./libraryGateway")>(), ...mocks }));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.getLibraryHome.mockResolvedValue(libraryHome(0));
  mocks.getCollectionDetail.mockImplementation(async id => ({ ...importedDetail, summary: { ...importedDetail.summary, id } }));
  mocks.listCollectionEpisodePage.mockResolvedValue({ items: [], totalCount: 0, nextOffset: null, snapshotToken: "snapshot" });
  mocks.listenLibraryScanProgress.mockResolvedValue(() => undefined);
});

it.each(["another collection", "closed collection", "another season"])("does not reopen an old collection after removing an item and navigating to %s", async destination => {
  const pending = deferred<CollectionDetail>();
  mocks.removeProjectFromCollection.mockReturnValue(pending.promise);
  const hook = renderHook(() => useLibraryController());
  await waitFor(() => expect(hook.result.current.state.loading).toBe(false));
  await act(async () => { await hook.result.current.openCollection(importedDetail.summary.id); });
  let removal!: Promise<unknown>;
  act(() => { removal = hook.result.current.removeFromCollection(importedDetail.summary.id, "project"); });
  await act(async () => {
    if (destination === "another collection") await hook.result.current.openCollection("other");
    else if (destination === "closed collection") hook.result.current.closeCollection();
    else await hook.result.current.openCollection(importedDetail.summary.id, 2);
  });
  const calls = mocks.listCollectionEpisodePage.mock.calls.length;
  await act(async () => { pending.resolve(importedDetail); await removal; });
  expect(mocks.listCollectionEpisodePage).toHaveBeenCalledTimes(calls);
  expect(hook.result.current.state.currentCollection?.summary.id ?? null).toBe(destination === "another collection" ? "other" : destination === "closed collection" ? null : importedDetail.summary.id);
  if (destination === "another season") expect(hook.result.current.state.selectedSeason).toBe(2);
});

it("refreshes the affected collection when the browsing context has not changed", async () => {
  mocks.removeProjectFromCollection.mockResolvedValue(importedDetail);
  const hook = renderHook(() => useLibraryController());
  await waitFor(() => expect(hook.result.current.state.loading).toBe(false));
  await act(async () => { await hook.result.current.openCollection(importedDetail.summary.id, 2); });
  await act(async () => { await hook.result.current.removeFromCollection(importedDetail.summary.id, "project"); });
  expect(mocks.listCollectionEpisodePage).toHaveBeenCalledTimes(2);
  expect(mocks.listCollectionEpisodePage).toHaveBeenLastCalledWith(importedDetail.summary.id, 2, 0);
  expect(hook.result.current.state.selectedSeason).toBe(2);
});
