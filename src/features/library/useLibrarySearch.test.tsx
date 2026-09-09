import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLibrarySearch } from "./useLibrarySearch";
const mocks = vi.hoisted(() => ({ searchLibrary: vi.fn() }));
vi.mock("./libraryGateway", () => mocks);
beforeEach(() => { vi.useFakeTimers(); mocks.searchLibrary.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
it.each([false, true])("does not publish a late result after unmount (failure=%s)", async failure => {
  let finish!: () => void;
  mocks.searchLibrary.mockImplementation(() => new Promise((resolve, reject) => {
    finish = () => failure ? reject(new Error("late")) : resolve([]);
  }));
  const dispatch = vi.fn();
  const hook = renderHook(() => useLibrarySearch("query", dispatch));
  await act(() => vi.advanceTimersByTimeAsync(180));
  hook.unmount();
  dispatch.mockClear();
  await act(async () => { finish(); });
  expect(dispatch).not.toHaveBeenCalled();
});
it("debounces edits and invalidates pending results when the query is cleared", async () => {
  let finish!: () => void;
  mocks.searchLibrary.mockImplementation(() => new Promise(resolve => { finish = () => resolve([]); }));
  const dispatch = vi.fn();
  const hook = renderHook(({ query }) => useLibrarySearch(query, dispatch), { initialProps: { query: "first" } });
  hook.rerender({ query: " second " });
  await act(() => vi.advanceTimersByTimeAsync(180));
  expect(mocks.searchLibrary).toHaveBeenCalledTimes(1);
  expect(mocks.searchLibrary).toHaveBeenCalledWith("second");
  hook.rerender({ query: " " });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "search_loaded", results: [] });
  dispatch.mockClear();
  await act(async () => { finish(); });
  expect(dispatch).not.toHaveBeenCalled();
});
