import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CollectionSummary, LibraryMediaSummary } from "../../../types";
import { LibraryMediaListView } from "./LibraryMediaListView";

const collection: CollectionSummary = {
  id: "collection",
  kind: "manual",
  title: "周末电影",
  rootId: null,
  systemKey: null,
  posterPath: null,
  sortMode: "manual",
  autoPlayNext: false,
  lastOpenedAtMs: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  itemCount: 0,
  seasonCount: 0,
  watchedCount: 0,
  totalDurationMs: null,
};

const media: LibraryMediaSummary = {
  projectId: "project",
  projectTitle: "雨站台",
  displayName: "rain-platform.mp4",
  mediaLocator: "W:\\media\\rain-platform.mp4",
  mediaAvailable: true,
  posterPath: null,
  positionMs: 5_000,
  durationMs: 10_000,
  completedAtMs: null,
  lastOpenedAtMs: 2,
  createdAtMs: 1,
  originalSubtitleAvailable: false,
  chineseTranslationAvailable: false,
  collectionId: null,
  collectionTitle: null,
  seasonNumber: null,
  episodeNumber: null,
  absoluteOrder: null,
  episodeTitle: null,
  itemAvailability: null,
};

function renderList(
  kind: "watch_later" | "unclassified",
  overrides: Partial<React.ComponentProps<typeof LibraryMediaListView>> = {},
) {
  const props: React.ComponentProps<typeof LibraryMediaListView> = {
    kind,
    page: {
      items: [media],
      totalCount: 25,
      nextOffset: 24,
      initialized: true,
      loading: false,
      loadingMore: false,
      error: null,
    },
    collections: [collection],
    mutationPending: false,
    onRetry: vi.fn(),
    onLoadMore: vi.fn(),
    onOpen: vi.fn(),
    onRelink: vi.fn(),
    onDelete: vi.fn(),
    onOpenLocation: vi.fn(),
    onAddToCollection: vi.fn().mockResolvedValue(undefined),
    onRemoveFromCollection: vi.fn().mockResolvedValue(undefined),
    onSetWatched: vi.fn().mockResolvedValue(undefined),
    onSetWatchLater: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<LibraryMediaListView {...props} />);
  return props;
}

describe("LibraryMediaListView", () => {
  it("offers an explicit watched-state correction independent of playback position", () => {
    const props = renderList("unclassified");
    fireEvent.click(screen.getByRole("button", { name: "雨站台 的更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "标记为看完" }));
    expect(props.onSetWatched).toHaveBeenCalledWith("project", true);
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it("shows total and loaded counts and keeps one watch-later removal action", () => {
    const props = renderList("watch_later");

    expect(screen.getByText("共 25 个视频，已加载 1 个。"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "雨站台 的更多操作" }));
    expect(screen.queryByRole("menuitem", { name: "移出合集" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "取消稍后观看" }));
    expect(props.onSetWatchLater).toHaveBeenCalledWith("project", false);
  });

  it("offers unclassified classification actions and preserves rows on append errors", () => {
    const onLoadMore = vi.fn();
    const props = renderList("unclassified", {
      onLoadMore,
      page: {
        items: [media],
        totalCount: 25,
        nextOffset: 24,
        initialized: true,
        loading: false,
        loadingMore: false,
        error: "网络暂时不可用",
      },
    });

    expect(screen.getByText("雨站台")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "雨站台 的更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "加入「周末电影」" }));
    expect(props.onAddToCollection).toHaveBeenCalledWith("collection", "project");
    expect(screen.getByRole("alert")).toHaveTextContent("网络暂时不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
