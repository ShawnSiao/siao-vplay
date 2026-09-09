import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { mediaSummary } from "../libraryControllerTestFixtures";
import { PagedMediaList } from "./PagedMediaList";
const first = mediaSummary("first"), second = mediaSummary("second");
const renderItem = (item: typeof first) => <article key={item.projectId} className="library-media-item" data-project-id={item.projectId}><button>{item.projectId}</button></article>;
it.each([false, true])("restores removed-row focus only when it was lost (outside=%s)", outside => {
  const content = (items: typeof first[]) => <><button>outside</button><PagedMediaList items={items} empty={null} renderItem={renderItem} /></>;
  const { rerender } = render(content([first, second]));
  screen.getByRole("button", { name: "first" }).focus();
  if (outside) screen.getByRole("button", { name: "outside" }).focus();
  rerender(content([second]));
  expect(screen.getByRole("button", { name: outside ? "outside" : "second" })).toHaveFocus();
});

it("keeps an accessible focus target when the last item is removed", () => {
  const content = (items: typeof first[]) => <PagedMediaList contentKind="videos" items={items} empty={<p>列表已清空</p>} renderItem={renderItem} />;
  const { rerender } = render(content([first]));
  screen.getByRole("button", { name: "first" }).focus();
  rerender(content([]));
  expect(screen.getByRole("group", { name: "视频列表" })).toHaveFocus();
});

it("does not steal outside focus when a backend page arrives", () => {
  const content = (offset: number) => <><button>outside</button><PagedMediaList items={[offset ? second : first]} empty={null} renderItem={renderItem}
    page={{ offset, totalCount: 48, nextOffset: offset ? null : 24, loadingMore: false, error: null, loadMore: vi.fn(), reload: vi.fn() }} /></>;
  const { rerender } = render(content(0));
  screen.getByRole("button", { name: "outside" }).focus();
  rerender(content(24));
  expect(screen.getByRole("button", { name: "outside" })).toHaveFocus();
});

it("keeps cached previous-page navigation available during a legacy append", () => {
  render(<PagedMediaList items={Array.from({ length: 48 }, (_, index) => mediaSummary(`p${index}`))} empty={null} renderItem={renderItem}
    page={{ totalCount: 72, nextOffset: 48, loadingMore: true, error: null, loadMore: vi.fn(), reload: vi.fn() }} />);
  fireEvent.click(screen.getByRole("button", { name: "下一页剧集" }));
  expect(screen.getByRole("button", { name: "上一页剧集" })).toBeEnabled();
});
