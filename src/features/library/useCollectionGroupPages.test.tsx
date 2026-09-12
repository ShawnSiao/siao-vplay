import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCollectionGroupPages } from "./useCollectionGroupPages";
import { importedDetail } from "./libraryControllerTestFixtures";
import type { CollectionOverviewInput } from "../../generated/collection-overview-input";
import type { CollectionOverviewPage } from "../../generated/collection-overview-page";

const pageFor = (input: CollectionOverviewInput, total = 50): CollectionOverviewPage => ({
  scope: "collections", rootLinked: input.rootLinked, query: input.query, offset: input.offset,
  snapshotToken: (input.rootLinked ? "a" : "b").repeat(64), totalCount: total,
  nextOffset: input.offset + 24 < total ? input.offset + 24 : null,
  items: Array.from({ length: Math.min(24, Math.max(0, total - input.offset)) }, (_, i) => ({ ...importedDetail.summary,
    id: `${input.rootLinked}-${input.offset + i}`, title: `合集 ${input.offset + i}`, rootId: input.rootLinked ? "root" : null, systemKey: null,
  })),
});
it.each([[false, 1000], [true, 10000]] as const)("bounds collection scope %s across %i rows", async (scope, total) => {
  const read = vi.fn(async (input: CollectionOverviewInput) => pageFor(input, total));
  const { result } = renderHook(() => useCollectionGroupPages(scope, 0, read));
  await waitFor(() => expect(result.current.loading).toBe(false));
  while (result.current.page?.nextOffset != null) {
    await act(async () => { await result.current.next(); });
    expect(result.current.page!.items.length).toBeLessThanOrEqual(24);
    expect(result.current.page?.rootLinked).toBe(scope);
  }
  expect(read.mock.calls.every(([input]) => input.rootLinked === scope && input.query === "")).toBe(true);
});
it("keeps group cursors independent and refreshes after collection deletion", async () => {
  let manualTotal = 50;
  const read = vi.fn(async (input: CollectionOverviewInput) => pageFor(input, input.rootLinked ? 26 : manualTotal));
  const { result, rerender } = renderHook(({ revision }) => ({ manual: useCollectionGroupPages(false, revision, read), folder: useCollectionGroupPages(true, revision, read) }),
    { initialProps: { revision: 0 } });
  await waitFor(() => expect(result.current.manual.loading || result.current.folder.loading).toBe(false));
  await act(async () => { await result.current.manual.next(); });
  await act(async () => { await result.current.manual.next(); });
  expect(result.current.manual.page?.offset).toBe(48);
  expect(result.current.folder.page?.offset).toBe(0);
  manualTotal = 26; rerender({ revision: 1 });
  await waitFor(() => expect(result.current.manual.page?.totalCount).toBe(26));
  expect(result.current.manual.page?.offset).toBe(24);
  expect(result.current.folder.page?.offset).toBe(0);
});
it("clears the old scope and resets its cursor when the reader scope changes", async () => {
  let finish!: (page: CollectionOverviewPage) => void;
  const read = vi.fn((input: CollectionOverviewInput) => input.rootLinked ? new Promise<CollectionOverviewPage>(resolve => { finish = resolve; }) : Promise.resolve(pageFor(input)));
  const { result, rerender } = renderHook(({ scope }) => useCollectionGroupPages(scope, 0, read), { initialProps: { scope: false } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.next(); });
  rerender({ scope: true });
  expect(result.current.page).toBeNull();
  await act(async () => { finish(pageFor({ rootLinked: true, query: "", offset: 0, expectedSnapshotToken: null })); });
  expect(result.current.page).toMatchObject({ rootLinked: true, offset: 0 });
});
