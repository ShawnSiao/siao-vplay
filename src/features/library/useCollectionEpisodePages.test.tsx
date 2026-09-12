import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCollectionEpisodePages } from "./useCollectionEpisodePages";
import { mediaSummary } from "./libraryControllerTestFixtures";
const read = vi.hoisted(() => vi.fn());
vi.mock("./libraryGateway", () => ({ listCollectionEpisodePage: read }));
vi.mock("../../lib/desktop", () => ({ commandError: (error: Error) => error }));
const first = { items: [mediaSummary("a")], totalCount: 2, nextOffset: 1, snapshotToken: "snapshot" };
const second = { ...first, items: [mediaSummary("b")], nextOffset: null };
beforeEach(() => { read.mockReset().mockResolvedValue(first); });
it.each([1000, 10000])("retains only one page while traversing %i episodes", async totalCount => {
  read.mockImplementation(async (_id, _season, offset) => ({
    items: Array.from({ length: Math.min(24, totalCount - offset) }, (_, i) => mediaSummary(`p-${offset + i}`)),
    totalCount, nextOffset: offset + 24 < totalCount ? offset + 24 : null, snapshotToken: "snapshot",
  }));
  const { result } = renderHook(() => useCollectionEpisodePages("c", 1, true, "p"));
  await waitFor(() => expect(result.current.items).toHaveLength(24));
  while (result.current.nextOffset !== null) {
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items.length).toBeLessThanOrEqual(24);
  }
  expect(result.current.items.at(-1)?.projectId).toBe(`p-${totalCount - 1}`);
});
it("loads one page, serializes repeated clicks and replaces rows with the same snapshot", async () => {
  const { result } = renderHook(() => useCollectionEpisodePages("c", 1, true, "p"));
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValueOnce(second);
  await act(async () => { result.current.loadMore(); result.current.loadMore(); });
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith("c", 1, 1, "snapshot");
  expect(result.current.items.map(item => item.projectId)).toEqual(["b"]);
  expect(result.current.nextOffset).toBeNull();
});
it("keeps the first page after failure and retries the same offset", async () => {
  const { result } = renderHook(() => useCollectionEpisodePages("c", null, true, "p"));
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  read.mockRejectedValueOnce(new Error("暂时不可用"));
  await act(async () => result.current.loadMore());
  expect(result.current.items).toHaveLength(1);
  expect(result.current.error).toBe("暂时不可用");
  read.mockResolvedValueOnce(second);
  await act(async () => result.current.loadMore());
  expect(read).toHaveBeenLastCalledWith("c", null, 1, "snapshot");
  expect(result.current.items).toHaveLength(1);
});
it("rejects duplicate append and reloads from the beginning", async () => {
  const { result } = renderHook(() => useCollectionEpisodePages("c", null, true, "p"));
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  read.mockResolvedValueOnce({ ...second, items: first.items });
  await act(async () => result.current.loadMore());
  expect(result.current.error).toContain("重新加载");
  expect(result.current.items).toHaveLength(1);
  await act(async () => result.current.reload());
  expect(read).toHaveBeenLastCalledWith("c", null, 0, undefined);
  expect(result.current.error).toBeNull();
});
it("ignores requests completed after closing or changing the video", async () => {
  let finish!: (value: typeof first) => void;
  read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(({ enabled, session }) => useCollectionEpisodePages("c", null, enabled, session), {
    initialProps: { enabled: true, session: "old" },
  });
  rerender({ enabled: false, session: "new" });
  await act(async () => finish(first));
  expect(result.current.items).toEqual([]);
  expect(read).toHaveBeenCalledTimes(1);
  rerender({ enabled: true, session: "new" });
  await waitFor(() => expect(result.current.items).toHaveLength(1));
});
it("retries the failed previous page with its snapshot and backend page span", async () => {
  read.mockResolvedValueOnce({ ...first, totalCount: 3 });
  const { result } = renderHook(() => useCollectionEpisodePages("c", null, true, "p"));
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  read.mockResolvedValueOnce({ ...second, totalCount: 3, nextOffset: 2 });
  await act(async () => { await result.current.loadMore(); });
  read.mockResolvedValueOnce({ ...second, totalCount: 3, items: [mediaSummary("c")] });
  await act(async () => { await result.current.loadMore(); });
  read.mockRejectedValueOnce(new Error("读取失败"));
  await act(async () => { await result.current.loadPrevious(); });
  expect(result.current.offset).toBe(2);
  expect(result.current.items[0].projectId).toBe("c");
  expect(read).toHaveBeenLastCalledWith("c", null, 1, "snapshot");
  read.mockResolvedValueOnce({ ...second, totalCount: 3, nextOffset: 2 });
  await act(async () => { await result.current.retry(); });
  expect(read).toHaveBeenLastCalledWith("c", null, 1, "snapshot");
  expect(result.current.offset).toBe(1);
  expect(result.current.items.map(item => item.projectId)).toEqual(["b"]);
});
it.each([
  { ...second, snapshotToken: "changed" },
  { ...second, totalCount: 3 },
  { ...second, items: [], nextOffset: 1 },
])("rejects inconsistent continuation without dropping the visible page", async page => {
  const { result } = renderHook(() => useCollectionEpisodePages("c", null, true, "p"));
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  read.mockResolvedValueOnce(page);
  await act(async () => { await result.current.loadMore(); });
  expect(result.current.offset).toBe(0);
  expect(result.current.items.map(item => item.projectId)).toEqual(["a"]);
  expect(result.current.error).toContain("重新加载");
});
it("ignores a previous-page completion after switching sessions", async () => {
  const { result, rerender } = renderHook(({ session }) => useCollectionEpisodePages("c", null, true, session), {
    initialProps: { session: "old" },
  });
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  read.mockResolvedValueOnce(second);
  await act(async () => { await result.current.loadMore(); });
  let finish!: (value: typeof first) => void;
  read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  act(() => { void result.current.loadPrevious(); });
  read.mockResolvedValueOnce({ ...first, items: [mediaSummary("new")] });
  rerender({ session: "new" });
  await waitFor(() => expect(result.current.items[0]?.projectId).toBe("new"));
  await act(async () => { finish(first); });
  expect(result.current.items[0]?.projectId).toBe("new");
  expect(result.current.offset).toBe(0);
});
it("retains only the playing episode context outside the visible page and clears it on session change", async () => {
  const { result, rerender } = renderHook(({ session }) => useCollectionEpisodePages("c", null, true, session), {
    initialProps: { session: "a" },
  });
  await waitFor(() => expect(result.current.currentEpisode?.projectId).toBe("a"));
  read.mockResolvedValueOnce(second);
  await act(async () => { await result.current.loadMore(); });
  expect(result.current.items.map(item => item.projectId)).toEqual(["b"]);
  expect(result.current.currentEpisode?.projectId).toBe("a");
  read.mockResolvedValueOnce({ ...first, items: [mediaSummary("new")] });
  rerender({ session: "new" });
  await waitFor(() => expect(result.current.currentEpisode?.projectId).toBe("new"));
});
