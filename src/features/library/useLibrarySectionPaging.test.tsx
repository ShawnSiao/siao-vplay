import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptySectionPages } from "./librarySectionState";
import { useLibrarySectionPaging } from "./useLibrarySectionPaging";
import { mediaSummary } from "./libraryControllerTestFixtures";
import { useReducer } from "react";
import { reduceSectionPages } from "./librarySectionState";
const read = vi.hoisted(() => vi.fn());
vi.mock("./libraryGateway", () => ({ listLibrarySection: read }));
const page = { items: Array.from({ length: 6 }, (_, i) => mediaSummary(`tail-${i}`)), totalCount: 30, nextOffset: null, snapshotToken: "snapshot" };
function setup() {
  const pages = emptySectionPages(); pages.unclassified = { ...pages.unclassified, initialized: true, nextOffset: 24, totalCount: 30, snapshotToken: "snapshot" };
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
it("establishes a first-page snapshot instead of appending to a home preview", async () => {
  const pages = emptySectionPages();
  pages.unclassified = { ...pages.unclassified, initialized: true, items: [mediaSummary("preview")], nextOffset: 12 };
  const dispatch = vi.fn();
  const { result } = renderHook(() => useLibrarySectionPaging("series", pages, dispatch));
  await act(async () => { await result.current.loadMoreSection("unclassified"); });
  expect(read).toHaveBeenCalledWith("unclassified", 0, undefined);
  expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "section_page_loaded", append: false, snapshotToken: "snapshot" }));
});
it.each([{ ...page, snapshotToken: "changed" }, { ...page, totalCount: 29 }])("rejects inconsistent continuation and preserves state for retry", async value => {
  const { result, dispatch } = setup();
  read.mockResolvedValueOnce(value);
  await act(async () => { expect(await result.current.loadMoreSection("unclassified")).toBeNull(); });
  expect(dispatch.mock.calls.some(([action]) => action.type === "section_page_loaded")).toBe(false);
  expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "section_page_failed" }));
  await act(async () => { await result.current.loadMoreSection("unclassified"); });
  expect(read).toHaveBeenLastCalledWith("unclassified", 24, "snapshot");
});
it("replaces a 12-row home preview before continuing from the first page snapshot", async () => {
  const initial = emptySectionPages();
  initial.unclassified = { ...initial.unclassified, initialized: true, totalCount: 30, nextOffset: 12,
    items: Array.from({ length: 12 }, (_, i) => mediaSummary(`p-${i}`)) };
  const first = { ...page, items: Array.from({ length: 24 }, (_, i) => mediaSummary(`p-${i}`)), nextOffset: 24 };
  read.mockResolvedValueOnce(first).mockResolvedValueOnce(page);
  const { result } = renderHook(() => {
    const [pages, dispatch] = useReducer(reduceSectionPages, initial);
    return { pages, ...useLibrarySectionPaging("unclassified", pages, dispatch) };
  });
  await act(async () => { await result.current.loadMoreSection("unclassified"); });
  expect(read).toHaveBeenNthCalledWith(1, "unclassified", 0, undefined);
  expect(result.current.pages.unclassified.items).toHaveLength(24);
  expect(result.current.pages.unclassified.snapshotToken).toBe("snapshot");
  await act(async () => { await result.current.loadMoreSection("unclassified"); });
  expect(read).toHaveBeenNthCalledWith(2, "unclassified", 24, "snapshot");
  expect(result.current.pages.unclassified.items).toHaveLength(30);
});
