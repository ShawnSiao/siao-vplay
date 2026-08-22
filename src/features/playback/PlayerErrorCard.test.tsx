import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerErrorCard } from "./PlayerErrorCard";

describe("PlayerErrorCard", () => {
  it("keeps the viewer in context and offers an explicit retry", () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    render(
      <PlayerErrorCard
        message="视频暂时无法解码。可以重新检查本地播放支持。"
        onDismiss={onDismiss}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("无法读取这个视频");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "原文件、字幕版本和观看记录没有改变",
    );
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "稍后处理" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
