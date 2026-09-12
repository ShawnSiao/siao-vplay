import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useSubtitleHistoryPages } from "./useSubtitleHistoryPages";
const mocks = vi.hoisted(() => ({ current: vi.fn(), page: vi.fn() }));
vi.mock("../../lib/desktop", () => ({ listSubtitleVersions: mocks.current, commandError: (cause: Error) => cause }));
vi.mock("../../lib/subtitleMetadataPageGateway", () => ({ readSubtitleMetadataPage: mocks.page }));
const current = { id: "current", isCurrent: true, segments: [] };
const first = { offset: 0, nextOffset: 24, totalCount: 30, snapshotToken: "a".repeat(64), currentVersions: [{ id: "current", segmentCount: 0 }], items: [{ id: "first" }] };
beforeEach(() => { mocks.current.mockReset().mockResolvedValue([current]); mocks.page.mockReset().mockResolvedValue(first); });

it("keeps the catalog on failed paging, serializes repeated clicks and retries the same snapshot", async () => {
  const { result } = renderHook(() => useSubtitleHistoryPages("p"));
  await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const catalog = result.current.catalog;
  let fail!: (cause: Error) => void;
  mocks.page.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  act(() => { result.current.pagination?.next?.(); result.current.pagination?.next?.(); });
  expect(mocks.page).toHaveBeenCalledTimes(2);
  await act(async () => fail(new Error("读取失败")));
  expect(result.current.catalog).toBe(catalog);
  expect(result.current.pagination?.error).toBe("读取失败");
  const next = { ...first, offset: 24, nextOffset: null, items: [{ id: "last" }] };
  mocks.page.mockResolvedValueOnce(next);
  act(() => result.current.pagination?.next?.());
  await waitFor(() => expect(result.current.catalog?.page).toBe(next));
  expect(result.current.catalog?.currentVersions).toBe(catalog?.currentVersions);
  expect(mocks.current).toHaveBeenCalledOnce();
  expect(mocks.page).toHaveBeenLastCalledWith("p", 24, first.snapshotToken);
});

it("rejects count changes and reloads only metadata without replacing working tracks", async () => {
  const { result } = renderHook(() => useSubtitleHistoryPages("p"));
  await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const tracks = result.current.catalog?.currentVersions;
  mocks.page.mockResolvedValueOnce({ ...first, offset: 24, totalCount: 31 });
  act(() => result.current.pagination?.next?.());
  await waitFor(() => expect(result.current.pagination?.error).toContain("已变化"));
  expect(result.current.catalog?.page.offset).toBe(0);
  mocks.page.mockResolvedValueOnce({ ...first, snapshotToken: "b".repeat(64) });
  act(() => result.current.pagination?.reload());
  await waitFor(() => expect(result.current.catalog?.page.snapshotToken).toBe("b".repeat(64)));
  expect(result.current.catalog?.currentVersions).toBe(tracks);
  expect(mocks.page).toHaveBeenLastCalledWith("p", 0, undefined);
});

it("ignores a page completing after the owner unmounts", async () => {
  const { result, unmount } = renderHook(() => useSubtitleHistoryPages("p"));
  await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const catalog = result.current.catalog;
  let finish!: (value: unknown) => void;
  mocks.page.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => result.current.pagination?.next?.());
  unmount();
  await act(async () => finish({ ...first, offset: 24 }));
  expect(result.current.catalog).toBe(catalog);
});
