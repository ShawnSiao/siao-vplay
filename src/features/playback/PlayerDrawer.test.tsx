import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerDrawer } from "./PlayerDrawer";

describe("PlayerDrawer reading-first shell", () => {
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
});
