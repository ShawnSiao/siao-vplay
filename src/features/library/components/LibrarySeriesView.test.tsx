import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  importedDetail,
  libraryHome,
  mediaSummary,
} from "../libraryControllerTestFixtures";
import { LibrarySeriesView } from "./LibrarySeriesView";

describe("LibrarySeriesView", () => {
  it("renders only received rows and requests the next backend page", () => {
    const episodes = Array.from({ length: 120 }, (_, index) => ({
      ...mediaSummary(`episode-${index + 1}`),
      episodeNumber: index + 1,
    }));
    const detail = {
      ...importedDetail,
      summary: {
        ...importedDetail.summary,
        itemCount: episodes.length,
      },
    };
    const loadMore = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <LibrarySeriesView
        home={libraryHome(episodes.length)}
        currentCollection={detail}
        currentEpisodes={episodes.slice(0, 24)}
        collectionPagination={{ totalCount: 120, nextOffset: 24, loadingMore: false, error: null, loadMore, reload: vi.fn() }}
        selectedSeason={null}
        collectionLoading={false}
        mutationPending={false}
        onOpenCollection={vi.fn()}
        onCloseCollection={vi.fn()}
        onSelectSeason={vi.fn()}
        onCreateCollection={vi.fn()}
        onEditCollection={vi.fn()}
        onDeleteCollection={vi.fn()}
        onToggleAutoPlay={vi.fn()}
        onOpen={vi.fn()}
        onRelink={vi.fn()}
        onDelete={vi.fn()}
        onOpenLocation={vi.fn()}
        onAddToCollection={vi.fn().mockResolvedValue(undefined)}
        onRemoveFromCollection={vi.fn().mockResolvedValue(undefined)}
        onSetWatched={vi.fn().mockResolvedValue(undefined)}
        onSetWatchLater={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(container.querySelectorAll(".library-media-item")).toHaveLength(24);
    expect(screen.getByText("已显示 24 / 120 集")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "加载更多剧集" }));
    expect(loadMore).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".library-media-item")).toHaveLength(24);
  });
});
