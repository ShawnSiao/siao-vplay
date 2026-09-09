import { act, renderHook } from "@testing-library/react";
import { useReducer } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptySectionPages, reduceSectionPages } from "./librarySectionState";
import { useLibrarySectionPaging } from "./useLibrarySectionPaging";
import { mediaSummary } from "./libraryControllerTestFixtures";
const read = vi.hoisted(() => vi.fn());
vi.mock("./libraryGateway", () => ({ listLibrarySection: read }));
beforeEach(() => read.mockReset());
it.each((["unclassified", "watch_later", "continue_watching"] as const).flatMap(section => [1000, 10000].map(totalCount => ({ section, totalCount }))))("retains at most24 rows through $totalCount media in $section", async ({ section, totalCount }) => {
  read.mockImplementation(async (section, offset) => ({ section, offset, snapshotToken: "snapshot", totalCount,
    items: Array.from({ length: Math.min(24, totalCount - offset) }, (_, i) => mediaSummary(`p-${offset + i}`)),
    nextOffset: offset + 24 < totalCount ? offset + 24 : null,
  }));
  const { result } = renderHook(() => {
    const [pages, dispatch] = useReducer(reduceSectionPages, undefined, emptySectionPages);
    return { pages, ...useLibrarySectionPaging("series", pages, dispatch) };
  });
  await act(async () => { await result.current.loadSectionPage(section); });
  while (result.current.pages[section].nextOffset !== null) {
    await act(async () => { await result.current.loadMoreSection(section); });
    expect(result.current.pages[section].items.length).toBeLessThanOrEqual(24);
  }
  expect(result.current.pages[section].items.at(-1)?.projectId).toBe(`p-${totalCount - 1}`);
});
it("preserves the final page on previous-read failure and retries the same snapshot and span", async () => {
  read.mockImplementation(async (section, offset) => ({ section, offset, snapshotToken: "snapshot", totalCount: 3,
    items: [mediaSummary(`p-${offset}`)], nextOffset: offset < 2 ? offset + 1 : null }));
  const { result } = renderHook(() => {
    const [pages, dispatch] = useReducer(reduceSectionPages, undefined, emptySectionPages);
    return { pages, ...useLibrarySectionPaging("series", pages, dispatch) };
  });
  await act(async () => { await result.current.loadSectionPage("unclassified"); });
  await act(async () => { await result.current.loadMoreSection("unclassified"); });
  await act(async () => { await result.current.loadMoreSection("unclassified"); });
  read.mockRejectedValueOnce(new Error("读取失败"));
  await act(async () => { await result.current.loadPreviousSection("unclassified"); });
  expect(result.current.pages.unclassified.offset).toBe(2);
  expect(result.current.pages.unclassified.items[0].projectId).toBe("p-2");
  await act(async () => { await result.current.retrySection("unclassified"); });
  expect(read).toHaveBeenLastCalledWith("unclassified", 1, "snapshot");
  expect(result.current.pages.unclassified.offset).toBe(1);
  await act(async () => { await result.current.loadPreviousSection("unclassified"); });
  expect(read).toHaveBeenLastCalledWith("unclassified", 0, "snapshot");
});
