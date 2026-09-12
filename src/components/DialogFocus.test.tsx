import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

it("Escape closes only the top dialog and restores its trigger", () => {
  const closeOuter = vi.fn();
  function Nested() {
    const [inner, setInner] = useState(false);
    return <Dialog title="外层" onClose={closeOuter}>
      <button onClick={() => setInner(true)}>打开内层</button>
      {inner ? <Dialog title="内层" onClose={() => setInner(false)}><input aria-label="内层输入" /></Dialog> : null}
    </Dialog>;
  }
  render(<Nested />);
  const trigger = screen.getByRole("button", { name: "打开内层" });
  trigger.focus(); fireEvent.click(trigger);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(closeOuter).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "内层" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("focus cycling excludes hidden descendants and negative tabindex buttons", () => {
  render(<Dialog title="焦点" onClose={vi.fn()}>
    <button>有效操作</button>
    <div hidden><button>隐藏操作</button></div>
    <button tabIndex={-1}>仅程序定位</button>
    <div style={{ display: "none" }}><button>不可见操作</button></div>
  </Dialog>);
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "有效操作" })).toHaveFocus();
});

it("does not close a dialog while Escape is handling IME composition", () => {
  const close = vi.fn();
  render(<Dialog title="输入" onClose={close}><input /></Dialog>);
  fireEvent.keyDown(window, { key: "Escape", isComposing: true });
  expect(close).not.toHaveBeenCalled();
});
