import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptySectionPages } from "./librarySectionState";
import { useLibrarySectionPaging } from "./useLibrarySectionPaging";
const read = vi.hoisted(() => vi.fn());
vi.mock("./libraryGateway", () => ({ listLibrarySection: read }));
const page = { items: [], totalCount: 30, nextOffset: null };
function setup() {
  const pages = emptySectionPages(); pages.unclassified = { ...pages.unclassified, initialized: true, nextOffset: 24 };
  const dispatch = vi.fn();
  return { ...renderHook(() => useLibrarySectionPaging("series", pages, dispatch)), dispatch };
}
beforeEach(() => { read.mockReset().mockResolvedValue(page); });
it("serializes repeated load-more calls before a render", async () => {
  const { result } = setup();
  await act(async () => { await Promise.all([result.current.loadMoreSection("unclassified"), result.current.loadMoreSection("unclassified")]); });
  expect(read).toHaveBeenCalledTimes(1);
});
it("reload supersedes an append and a stale completion returns null", async () => {
  const { result, dispatch } = setup();
  let finish!: (value: typeof page) => void;
  read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let pending!: ReturnType<typeof result.current.loadMoreSection>;
  act(() => { pending = result.current.loadMoreSection("unclassified"); });
  await act(async () => { await result.current.loadSectionPage("unclassified"); });
  await act(async () => { finish(page); expect(await pending).toBeNull(); });
  expect(dispatch.mock.calls.filter(([action]) => action.type === "section_page_loaded")).toHaveLength(1);
});
it("does not append during an initial reload or write after unmount", async () => {
  const { result, dispatch, unmount } = setup();
  let finish!: (value: typeof page) => void;
  read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let pending!: ReturnType<typeof result.current.loadSectionPage>;
  act(() => { pending = result.current.loadSectionPage("unclassified"); });
  await act(async () => { expect(await result.current.loadMoreSection("unclassified")).toBeNull(); });
  expect(read).toHaveBeenCalledTimes(1);
  unmount(); dispatch.mockClear();
  await act(async () => { finish(page); expect(await pending).toBeNull(); });
  expect(dispatch).not.toHaveBeenCalled();
});

it("an old completion cannot release a newer reload", async () => {
  const { result } = setup();
  let finishOld!: (value: typeof page) => void, finishNew!: (value: typeof page) => void;
  read.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
  read.mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
  act(() => { void result.current.loadMoreSection("unclassified"); });
  act(() => { void result.current.loadSectionPage("unclassified"); });
  await act(async () => { finishOld(page); });
  await act(async () => { expect(await result.current.loadMoreSection("unclassified")).toBeNull(); });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => { finishNew(page); });
});
