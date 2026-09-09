import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
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
