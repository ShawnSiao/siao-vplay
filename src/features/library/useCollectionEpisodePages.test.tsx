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
it("loads one page, serializes repeated clicks and appends with the same snapshot", async () => {
  const { result } = renderHook(() => useCollectionEpisodePages("c", 1, true, "p"));
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValueOnce(second);
  await act(async () => { result.current.loadMore(); result.current.loadMore(); });
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith("c", 1, 1, "snapshot");
  expect(result.current.items.map(item => item.projectId)).toEqual(["a", "b"]);
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
  expect(result.current.items).toHaveLength(2);
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
