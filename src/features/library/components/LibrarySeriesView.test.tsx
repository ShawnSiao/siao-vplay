import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  importedDetail,
  libraryHome,
  mediaSummary,
} from "../libraryControllerTestFixtures";
import { LibrarySeriesView } from "./LibrarySeriesView";

describe("LibrarySeriesView", () => {
  it("renders large collections in bounded batches", () => {
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
    const { container } = render(
      <LibrarySeriesView
        home={libraryHome(episodes.length)}
        currentCollection={detail}
        currentEpisodes={episodes}
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

    expect(container.querySelectorAll(".library-media-item")).toHaveLength(50);
    expect(screen.getByText("已显示 50 / 120 集")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "再显示 50 集" }));
    expect(container.querySelectorAll(".library-media-item")).toHaveLength(100);
    expect(screen.getByText("已显示 100 / 120 集")).toBeVisible();
  });
});
