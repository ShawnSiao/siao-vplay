import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("traps focus, gives Escape modal priority, and restores prior focus", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "打开";
    document.body.append(trigger);
    trigger.focus();

    const close = vi.fn();
    const backgroundShortcut = vi.fn();
    window.addEventListener("keydown", backgroundShortcut);
    const view = render(
      <Dialog
        title="可读性检查"
        eyebrow="模态对话框"
        onClose={close}
        actions={<button type="button">完成</button>}
      >
        <label>
          名称
          <input aria-label="名称" />
        </label>
      </Dialog>,
    );

    const closeButton = screen.getByRole("button", { name: "关闭" });
    const doneButton = screen.getByRole("button", { name: "完成" });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(doneButton).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();
    backgroundShortcut.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    expect(backgroundShortcut).not.toHaveBeenCalled();

    view.unmount();
    expect(trigger).toHaveFocus();
    window.removeEventListener("keydown", backgroundShortcut);
    trigger.remove();
  });

  it("does not reset focus when the close callback identity changes", () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const view = render(
      <Dialog title="后台任务" onClose={firstClose}>
        <input aria-label="任务名称" />
      </Dialog>,
    );
    const input = screen.getByRole("textbox", { name: "任务名称" });
    input.focus();

    view.rerender(
      <Dialog title="后台任务" onClose={secondClose}>
        <input aria-label="任务名称" />
      </Dialog>,
    );

    expect(input).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledOnce();
  });
});
