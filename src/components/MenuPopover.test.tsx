import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MenuPopover } from "./MenuPopover";

function Fixture() {
  return (
    <div>
      <MenuPopover label="第一个菜单">
        <button type="button" role="menuitem">重命名</button>
      </MenuPopover>
      <MenuPopover label="第二个菜单">
        <button type="button" role="menuitem">打开位置</button>
      </MenuPopover>
      <button type="button">页面空白区域</button>
    </div>
  );
}

describe("MenuPopover", () => {
  it("keeps only one menu open", () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "第一个菜单" }));
    expect(screen.getAllByRole("menu", { hidden: true })[0]).not.toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "第二个菜单" }));
    const menus = screen.getAllByRole("menu", { hidden: true });
    expect(menus[0]).toHaveAttribute("hidden");
    expect(menus[1]).not.toHaveAttribute("hidden");
  });

  it("keeps internal scrolling open and closes from external interactions", () => {
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "第一个菜单" });
    const menu = screen.getAllByRole("menu", { hidden: true })[0];

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "页面空白区域" }));
    expect(menu).toHaveAttribute("hidden");

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu).toHaveAttribute("hidden");
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.scroll(menu);
    expect(menu).not.toHaveAttribute("hidden");
    fireEvent.scroll(document);
    expect(menu).toHaveAttribute("hidden");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    expect(menu).toHaveAttribute("hidden");
  });
});
