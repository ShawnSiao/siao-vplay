import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../types";
import type { MediaPreparationProgress } from "../lib/mediaPreparationGateway";
import { PreparationScreen } from "./PreparationScreen";
const settings = vi.hoisted(() => ({ openEnvironmentSettings: vi.fn() }));
vi.mock("../features/environment-settings/events", () => settings);

const project = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "雨站台",
} as Project;

describe("PreparationScreen", () => {
  it.each([false, true])("shows actual stages without invented percentages for forceProxy=%s", forceProxy => {
    const stages: [MediaPreparationProgress["stage"], string][] = [
      ["runtime", "检查播放组件"], ["fingerprint", "核对视频文件"],
      ["inspect", "检查视频与音频"], ["transcode", "生成兼容播放版本"],
      ["validate", "检查生成的播放版本"], ["finalize", "保存播放版本"],
    ];
    const props = { project, forceProxy, error: null, cancelling: false, canCancel: true,
      onCancel: vi.fn(), onRetry: vi.fn(), onBack: vi.fn() };
    const { rerender } = render(<PreparationScreen {...props} progress={null} />);
    for (const [stage, label] of stages) {
      rerender(<PreparationScreen {...props} progress={{ requestId: "request", projectId: project.id, stage, status: "running" }} />);
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    }
  });

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

    expect(screen.getByText("已用时 · 0 秒")).toBeVisible();
    const cancel = screen.getByRole("button", { name: "取消并返回媒体库" });
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText("生成兼容播放版本")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "返回媒体库" }));
    expect(onBack).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText("已用时 · 6 秒")).toBeVisible();
  });
});

it("describes a queued preparation honestly and keeps cancellation separate from returning", () => {
  const onCancel = vi.fn(); const onBack = vi.fn();
  render(<PreparationScreen project={project} forceProxy progress={{ requestId:"queued",projectId:project.id,stage:"queued",status:"running" }}
    error={null} cancelling={false} canCancel onCancel={onCancel} onBack={onBack} onRetry={vi.fn()} />);
  expect(screen.getByText("正在等待开始处理。可以返回媒体库，或取消本次准备。")).toBeVisible();
  expect(screen.getByText("轮到这段视频后会继续准备播放。")).toBeVisible();
  expect(screen.getByText("已用时 · 0 秒")).toBeVisible();
  fireEvent.click(screen.getByRole("button",{ name:"取消并返回媒体库" }));
  expect(onCancel).toHaveBeenCalledOnce(); expect(onBack).not.toHaveBeenCalled();
});
