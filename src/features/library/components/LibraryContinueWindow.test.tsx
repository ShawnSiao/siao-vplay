import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LibraryContinueWindow } from "./LibraryContinueWindow";
import { LibraryHomeView } from "./LibraryHomeView";
import { emptySectionPage } from "../librarySectionState";
import { libraryHome, mediaSummary } from "../libraryControllerTestFixtures";

it("preserves outside focus when a continue-watching page arrives", () => {
  const content = (offset: number) => <><button>外部入口</button><LibraryContinueWindow count={1}
    pagination={{ offset, totalCount: 30, nextOffset: null, loadingMore: false, error: null, loadMore: vi.fn(), reload: vi.fn() }}>
    <article className="library-continue-hero"><button>观看</button></article>
  </LibraryContinueWindow></>;
  const { rerender } = render(content(0));
  screen.getByRole("button", { name: "外部入口" }).focus();
  rerender(content(24));
  expect(screen.getByRole("button", { name: "外部入口" })).toHaveFocus();
});
it("does not restore stale home-preview rows when the initialized page is empty", () => {
  render(<LibraryHomeView home={{ ...libraryHome(1), continueWatching: [mediaSummary("old")] }}
    continuePage={{ ...emptySectionPage(), initialized: true }} previewMode={false}
    onOpen={vi.fn()} onOpenCollection={vi.fn()} onSelectSeries={vi.fn()} onImport={vi.fn()} onLoadMore={vi.fn()} />);
  expect(screen.queryByText("视频 old")).toBeNull();
  expect(screen.getByText("还没有观看记录")).toBeVisible();
});
