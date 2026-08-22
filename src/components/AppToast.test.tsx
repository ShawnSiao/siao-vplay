import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppToast } from "./AppToast";

describe("AppToast", () => {
  it("renders a structured current-project result without engineering terms", () => {
    render(
      <AppToast
        notice={{
          title: "中文字幕已准备好",
          message: "当前视频可以切换为中文或双语字幕。",
          tone: "success",
        }}
        onDismiss={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("中文字幕已准备好");
    expect(screen.getByRole("status")).not.toHaveTextContent("Agent");
  });

  it("can be dismissed explicitly", () => {
    const onDismiss = vi.fn();
    render(<AppToast notice="操作没有完成" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
