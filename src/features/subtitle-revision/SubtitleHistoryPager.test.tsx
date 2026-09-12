import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SubtitleHistoryPager } from "./SubtitleHistoryPager";
it("retains keyboard focus when the last page removes the next button", () => {
  const first = { offset: 0, count: 24, totalCount: 30, error: null, loading: false, next: vi.fn(), reload: vi.fn() };
  const { rerender } = render(<SubtitleHistoryPager page={first} />);
  screen.getByRole("button", { name: "下一页版本" }).focus();
  rerender(<SubtitleHistoryPager page={{ ...first, offset: 24, count: 6, next: undefined, previous: vi.fn() }} />);
  expect(screen.getByRole("group", { name: "字幕历史分页" })).toHaveFocus();
});
