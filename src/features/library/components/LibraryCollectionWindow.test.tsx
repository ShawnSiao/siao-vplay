import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { importedDetail, libraryHome, mediaSummary } from "../libraryControllerTestFixtures";
import { LibrarySeriesView } from "./LibrarySeriesView";
function view(count: number) {
  const episodes = Array.from({ length: count }, (_, index) => mediaSummary(`episode-${index + 1}`));
  return { episodes, props: { refreshKey: libraryHome(count), currentCollection: importedDetail, currentEpisodes: episodes,
    selectedSeason: null, collectionLoading: false, mutationPending: false,
    onOpenCollection: vi.fn(), onCloseCollection: vi.fn(), onSelectSeason: vi.fn(), onCreateCollection: vi.fn(), onEditCollection: vi.fn(),
    onDeleteCollection: vi.fn(), onToggleAutoPlay: vi.fn(), onOpen: vi.fn(), onRelink: vi.fn(), onDelete: vi.fn(), onOpenLocation: vi.fn(),
    onAddToCollection: vi.fn(), onRemoveFromCollection: vi.fn(), onSetWatchLater: vi.fn(), onSetWatched: vi.fn() } };
}
it.each([120, 1000, 10000])("bounds %i accumulated rows while preserving page navigation", count => {
  const { props } = view(count);
  const { container } = render(<LibrarySeriesView {...props} />);
  expect(container.querySelectorAll(".library-media-item")).toHaveLength(24);
  fireEvent.click(screen.getByRole("button", { name: "下一页剧集" }));
  expect(container.querySelectorAll(".library-media-item")).toHaveLength(24);
  expect(screen.getByText("视频 episode-25")).toBeVisible();
  expect(screen.queryByText("视频 episode-1")).toBeNull();
  expect(container.querySelector(".library-media-item button")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "上一页剧集" }));
  expect(screen.getByText("视频 episode-1")).toBeVisible();
});
it("preserves the current page after a failed append and shows new rows only after success", async () => {
  const { props, episodes } = view(48);
  const page = { totalCount: 48, nextOffset: 24, loadingMore: false, error: null, loadMore: vi.fn().mockResolvedValue(false), reload: vi.fn() };
  const { rerender } = render(<LibrarySeriesView {...props} currentEpisodes={episodes.slice(0, 24)} collectionPagination={page} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "加载更多剧集" })); });
  expect(screen.getByText("视频 episode-1")).toBeVisible();
  page.loadMore.mockImplementationOnce(async () => {
    rerender(<LibrarySeriesView {...props} collectionPagination={{ ...page, nextOffset: null }} />);
    return true;
  });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "加载更多剧集" })); });
  expect(screen.getByText("视频 episode-25")).toBeVisible();
  expect(screen.queryByText("视频 episode-1")).toBeNull();
});

it("does not override a previous-page action when an append finishes", async () => {
  const { props, episodes } = view(72);
  let finish!: (value: boolean) => void;
  const page = { totalCount: 72, nextOffset: 48, loadingMore: false, error: null,
    loadMore: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })), reload: vi.fn() };
  const { rerender } = render(<LibrarySeriesView {...props} currentEpisodes={episodes.slice(0, 48)} collectionPagination={page} />);
  fireEvent.click(screen.getByRole("button", { name: "下一页剧集" }));
  fireEvent.click(screen.getByRole("button", { name: "加载更多剧集" }));
  fireEvent.click(screen.getByRole("button", { name: "上一页剧集" }));
  await act(async () => { rerender(<LibrarySeriesView {...props} collectionPagination={{ ...page, nextOffset: null }} />); finish(true); });
  expect(screen.getByText("视频 episode-1")).toBeVisible();
  expect(screen.queryByText("视频 episode-49")).toBeNull();
});

it("keeps the first append intent when load-more is activated twice", async () => {
  const { props, episodes } = view(48);
  let finish!: (value: boolean) => void;
  const loadMore = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; })).mockResolvedValue(false);
  const page = { totalCount: 48, nextOffset: 24, loadingMore: false, error: null, loadMore, reload: vi.fn() };
  const { rerender } = render(<LibrarySeriesView {...props} currentEpisodes={episodes.slice(0, 24)} collectionPagination={page} />);
  const button = screen.getByRole("button", { name: "加载更多剧集" });
  fireEvent.click(button); fireEvent.click(button);
  expect(loadMore).toHaveBeenCalledOnce();
  await act(async () => { rerender(<LibrarySeriesView {...props} collectionPagination={{ ...page, nextOffset: null }} />); finish(true); });
  expect(screen.getByText("视频 episode-25")).toBeVisible();
});
