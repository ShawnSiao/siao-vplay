import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerDrawer } from "./PlayerDrawer";

describe("PlayerDrawer reading-first shell", () => {
  it("moves tab focus without changing the active workflow until activation", () => {
    const select = vi.fn();
    render(<PlayerDrawer activeTab="understand" mediaTitle="视频" onSelectTab={select} onClose={vi.fn()}><p>正文</p></PlayerDrawer>);
    const active = screen.getByRole("tab", { name: "理解" });
    const next = screen.getByRole("tab", { name: "学习" });
    active.focus();
    fireEvent.keyDown(active, { key: "ArrowRight" });
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("tabindex", "0");
    expect(active).toHaveAttribute("tabindex", "-1");
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(next, { key: "Home" });
    expect(screen.getByRole("tab", { name: "剧集" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "逐字稿" })).toHaveFocus();
    fireEvent.click(screen.getByRole("tab", { name: "逐字稿" }));
    expect(select).toHaveBeenCalledWith("transcript");
  });
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("offers readable tab context and a recoverable density preference", () => {
    const view = render(
      <PlayerDrawer
        activeTab="understand"
        mediaTitle="Hugging Face Journal Club: Kimi K3"
        onSelectTab={vi.fn()}
        onClose={vi.fn()}
      >
        <p>当前内容</p>
      </PlayerDrawer>,
    );

    const drawer = screen.getByRole("complementary", {
      name: "当前内容抽屉",
    });
    expect(drawer).toHaveAttribute("data-density", "comfortable");
    expect(screen.getByText("正在观看")).toBeInTheDocument();
    expect(screen.getByText("当前场景")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "舒适" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(drawer).toHaveAttribute("data-density", "compact");
    expect(
      screen.getByRole("button", { name: "紧凑" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("siaovplay-drawer-density")).toBe(
      "compact",
    );

    view.unmount();
    render(
      <PlayerDrawer
        activeTab="learn"
        mediaTitle="Hugging Face Journal Club: Kimi K3"
        onSelectTab={vi.fn()}
        onClose={vi.fn()}
      >
        <p>当前内容</p>
      </PlayerDrawer>,
    );
    expect(
      screen.getByRole("complementary", { name: "当前内容抽屉" }),
    ).toHaveAttribute("data-density", "compact");
  });

  it("exposes synchronized transcript as a fourth peer tab", () => {
    const onSelectTab = vi.fn();
    render(
      <PlayerDrawer
        activeTab="transcript"
        mediaTitle="测试视频"
        onSelectTab={onSelectTab}
        onClose={vi.fn()}
      >
        <p>逐字稿正文</p>
      </PlayerDrawer>,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "逐字稿" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText("阅读密度")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "理解" }));
    expect(onSelectTab).toHaveBeenCalledWith("understand");
  });
});
