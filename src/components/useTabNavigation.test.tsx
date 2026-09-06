import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useTabNavigation } from "./useTabNavigation";

function Example() {
  const [active, setActive] = useState("first");
  const tabs = useTabNavigation(active, setActive);
  return <><div {...tabs.listProps} aria-label="测试页签">
    <button {...tabs.tabProps("first")}>第一页</button>
    <button {...tabs.tabProps("disabled")} disabled>不可用页</button>
    <button {...tabs.tabProps("last")}>最后页</button>
  </div><div {...tabs.panelProps}>{active}</div><button>后续操作</button></>;
}
it("skips disabled tabs and resets entry focus to the selected tab when leaving", () => {
  render(<Example />);
  const first = screen.getByRole("tab", { name: "第一页" });
  const last = screen.getByRole("tab", { name: "最后页" });
  act(() => first.focus()); fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(last).toHaveFocus();
  expect(first).toHaveAttribute("aria-selected", "true");
  act(() => screen.getByRole("button", { name: "后续操作" }).focus());
  expect(first).toHaveAttribute("tabindex", "0");
  fireEvent.click(last);
  expect(screen.getByRole("tabpanel")).toHaveTextContent("last");
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", last.id);
});
it("does not consume scrolling keys, modified navigation, or text composition", () => {
  render(<Example />);
  const first = screen.getByRole("tab", { name: "第一页" });
  act(() => first.focus());
  expect(fireEvent.keyDown(first, { key: "ArrowDown" })).toBe(true);
  expect(fireEvent.keyDown(first, { key: "ArrowRight", ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(first, { key: "ArrowRight", isComposing: true })).toBe(true);
  expect(first).toHaveFocus();
});
