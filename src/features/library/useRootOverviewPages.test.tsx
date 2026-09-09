import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useRootOverviewPages } from "./useRootOverviewPages";
import type { OverviewPageInput } from "../../generated/overview-page-input";
import type { RootOverviewPage } from "../../generated/root-overview-page";
const token = "a".repeat(64);
const pageFor = (input: OverviewPageInput, total = 50): RootOverviewPage => ({ scope: "roots", offset: input.offset,
  snapshotToken: token, totalCount: total, nextOffset: input.offset + 24 < total ? input.offset + 24 : null,
  items: Array.from({ length: Math.min(24, Math.max(0, total - input.offset)) }, (_, i) => ({
    id: `root-${input.offset + i}`, displayName: `目录 ${input.offset + i}`, path: "W:\\fixture",
    status: "linked", availability: "available", itemCount: 1, lastScannedAtMs: null,
  })),
});
it.each([1000, 10000])("bounds root page state through %i entries", async total => {
  const read = vi.fn(async (input: OverviewPageInput) => pageFor(input, total));
  const { result } = renderHook(() => useRootOverviewPages(read));
  await waitFor(() => expect(result.current.loading).toBe(false));
  while (result.current.page?.nextOffset != null) {
    await act(async () => { await result.current.next(); });
    expect(result.current.page!.items.length).toBeLessThanOrEqual(24);
  }
  expect(result.current.page?.offset).toBe(Math.floor((total - 1) / 24) * 24);
  await act(async () => { await result.current.previous(); });
  expect(read.mock.calls.at(-1)?.[0].expectedSnapshotToken).toBe(token);
});
it("refreshes the current window, clamps deleted last pages and clears an emptied list", async () => {
  let total = 50;
  const read = vi.fn(async (input: OverviewPageInput) => pageFor(input, total));
  const { result, rerender } = renderHook(({ revision }) => useRootOverviewPages(read, revision), { initialProps: { revision: 0 } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.next(); });
  await act(async () => { await result.current.next(); });
  rerender({ revision: 1 });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.page?.offset).toBe(48);
  expect(read.mock.calls.at(-2)?.[0]).toEqual({ offset: 0, expectedSnapshotToken: null });
  total = 26; rerender({ revision: 2 });
  await waitFor(() => expect(result.current.page?.totalCount).toBe(26));
  expect(result.current.page?.offset).toBe(24);
  total = 0; rerender({ revision: 3 });
  await waitFor(() => expect(result.current.page?.totalCount).toBe(0));
  expect(result.current.page?.offset).toBe(0);
  expect(result.current.page?.items).toHaveLength(0);
});
it("retries a failed continuation and uses a fresh snapshot when reloading", async () => {
  const read = vi.fn(async (input: OverviewPageInput) => pageFor(input));
  const { result } = renderHook(() => useRootOverviewPages(read));
  await waitFor(() => expect(result.current.loading).toBe(false));
  read.mockRejectedValueOnce(new Error("暂时失败"));
  await act(async () => { await result.current.next(); });
  expect(result.current.page?.offset).toBe(0);
  expect(result.current.error).toContain("暂时失败");
  await act(async () => { await result.current.retry(); });
  expect(result.current.page?.offset).toBe(24);
  await act(async () => { await result.current.reload(); });
  expect(read.mock.calls.at(-2)?.[0]).toEqual({ offset: 0, expectedSnapshotToken: null });
  expect(result.current.page?.offset).toBe(24);
});
it("rejects stale navigation after refresh and ignores reads after unmount", async () => {
  let finish!: (page: RootOverviewPage) => void;
  const read = vi.fn(async (input: OverviewPageInput) => pageFor(input));
  const { result, rerender, unmount } = renderHook(({ revision }) => useRootOverviewPages(read, revision), { initialProps: { revision: 0 } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<boolean>;
  act(() => { pending = result.current.next(); });
  rerender({ revision: 1 });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { finish(pageFor({ offset: 24, expectedSnapshotToken: token })); await pending; });
  expect(result.current.page?.offset).toBe(0);
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => { pending = result.current.reload(); });
  unmount(); finish(pageFor({ offset: 0, expectedSnapshotToken: null }));
  await expect(pending).resolves.toBe(false);
});
