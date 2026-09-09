import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCollectionOverviewPages } from "./useCollectionOverviewPages";
import { importedDetail } from "./libraryControllerTestFixtures";
import type { CollectionOverviewInput } from "../../generated/collection-overview-input";
import type { CollectionOverviewPage } from "../../generated/collection-overview-page";

const token = "a".repeat(64);
const pageFor = (input: CollectionOverviewInput, total = 26): CollectionOverviewPage => ({
  scope: "collections", rootLinked: input.rootLinked, query: input.query, offset: input.offset, snapshotToken: token,
  totalCount: total, nextOffset: input.offset + 24 < total ? input.offset + 24 : null,
  items: Array.from({ length: Math.min(24, Math.max(0, total - input.offset)) }, (_, i) => ({
    ...importedDetail.summary, id: `c-${input.offset + i}`, title: `${input.query} ${input.offset + i}`, systemKey: null,
    rootId: input.rootLinked ? "root" : null,
  })),
});
it.each([1000, 10000])("retains at most one page while traversing %i collections", async total => {
  const read = vi.fn(async (input: CollectionOverviewInput) => pageFor(input, total));
  const { result } = renderHook(() => useCollectionOverviewPages(read));
  await waitFor(() => expect(result.current.loading).toBe(false));
  while (result.current.page?.nextOffset != null) {
    await act(async () => { await result.current.next(); });
    expect(result.current.page!.items.length).toBeLessThanOrEqual(24);
  }
  expect(result.current.page?.offset).toBe(Math.floor((total - 1) / 24) * 24);
  await act(async () => { await result.current.previous(); });
  expect(result.current.page!.items).toHaveLength(24);
  expect(read.mock.calls.at(-1)?.[0].expectedSnapshotToken).toBe(token);
});
it("retries the failed cursor and binds previous page zero to the snapshot", async () => {
  const read = vi.fn(async (input: CollectionOverviewInput) => pageFor(input));
  const { result } = renderHook(() => useCollectionOverviewPages(read));
  await waitFor(() => expect(result.current.loading).toBe(false));
  read.mockRejectedValueOnce(new Error("暂时无法读取"));
  await act(async () => { await result.current.next(); });
  expect(result.current.error).toContain("暂时无法读取");
  expect(result.current.page?.offset).toBe(0);
  await act(async () => { await result.current.retry(); });
  expect(result.current.page?.offset).toBe(24);
  expect(result.current.page?.items).toHaveLength(2);
  await act(async () => { await result.current.previous(); });
  expect(read.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0, expectedSnapshotToken: token });
  read.mockRejectedValueOnce(new Error("快照已变化"));
  await act(async () => { await result.current.next(); });
  await act(async () => { await result.current.reload(); });
  expect(result.current.error).toBeNull();
  expect(read.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0, expectedSnapshotToken: null });
});
it("ignores inverted query responses and reads finishing after close", async () => {
  let finish!: (page: CollectionOverviewPage) => void;
  const read = vi.fn(async (input: CollectionOverviewInput) => pageFor(input));
  const { result, unmount } = renderHook(() => useCollectionOverviewPages(read));
  await waitFor(() => expect(result.current.loading).toBe(false));
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let oldRequest!: Promise<boolean>;
  act(() => { oldRequest = result.current.search("old", false); });
  expect(result.current.page).toBeNull();
  await act(async () => { await result.current.search("new", true); });
  await act(async () => { finish(pageFor({ offset: 0, query: "old", rootLinked: false, expectedSnapshotToken: null })); await oldRequest; });
  expect(result.current.page).toMatchObject({ query: "new", rootLinked: true });
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => { oldRequest = result.current.reload(); });
  unmount();
  finish(pageFor({ offset: 0, query: "new", rootLinked: true, expectedSnapshotToken: null }));
  await expect(oldRequest).resolves.toBe(false);
});
