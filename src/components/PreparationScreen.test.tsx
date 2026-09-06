import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../types";
import { PreparationScreen } from "./PreparationScreen";
const settings = vi.hoisted(() => ({ openEnvironmentSettings: vi.fn() }));
vi.mock("../features/environment-settings/events", () => settings);

const project = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "雨站台",
} as Project;

describe("PreparationScreen", () => {
  it("opens storage settings from a failed preparation and retains retry", () => {
    const retry = vi.fn();
    render(<PreparationScreen project={project} forceProxy error="空间不足" progress={null} cancelling={false} canCancel={false} onCancel={vi.fn()} onRetry={retry} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "存储设置" }));
    expect(settings.openEnvironmentSettings).toHaveBeenCalledWith("storage");
    fireEvent.click(screen.getByRole("button", { name: "重新尝试" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps a visible cancel action and reports elapsed time", () => {
    vi.useFakeTimers();
    const onBack = vi.fn();
    const onCancel = vi.fn();
    render(
      <PreparationScreen
        project={project}
        forceProxy={false}
        error={null}
        progress={{ requestId: "request", projectId: project.id, stage: "transcode", status: "running" }}
        cancelling={false}
        canCancel
        onCancel={onCancel}
        onRetry={vi.fn()}
        onBack={onBack}
      />,
    );

    expect(screen.getByText("已处理 · 0 秒")).toBeVisible();
    const cancel = screen.getByRole("button", { name: "取消并返回媒体库" });
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText("生成兼容播放版本")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "返回媒体库" }));
    expect(onBack).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText("已处理 · 6 秒")).toBeVisible();
  });
});
