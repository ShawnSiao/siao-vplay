import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Explanation } from "../types";

const desktopMocks = vi.hoisted(() => ({
  getCodexRuntimeStatus: vi.fn(),
  listExplanationTasks: vi.fn(),
  listExplanations: vi.fn(),
}));

vi.mock("../lib/desktop", () => ({
  ...desktopMocks,
  commandError: (error: unknown) => ({
    code: "test_error",
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import { UnderstandingPanel } from "./UnderstandingPanel";

const explanation: Explanation = {
  id: "explanation-1",
  projectId: "project-1",
  taskId: "task-1",
  sourceVersionId: "source-1",
  translationVersionId: null,
  playbackCutoffMs: 1326000,
  sceneStartMs: 0,
  confirmedFacts: [
    "事实一：报告提出了新的验证问题。",
    "事实二：说话者承认目前证据还不完整。",
    "事实三：现场展示了报告中的工作流程。",
    "事实四：后续仍需要检查结果。",
  ],
  possibleInterpretations: [
    "这可能意味着团队正在重新评估自动化任务的边界。",
  ],
  withheldReason: null,
  createdAtMs: 1,
};

describe("UnderstandingPanel reading flow", () => {
  beforeEach(() => {
    desktopMocks.getCodexRuntimeStatus.mockResolvedValue({
      available: true,
      authenticated: true,
      supported: true,
      version: "test",
      authMode: "chatgpt",
      minimumVersion: "1",
      errorCode: null,
      errorMessage: null,
    });
    desktopMocks.listExplanationTasks.mockResolvedValue([]);
    desktopMocks.listExplanations.mockResolvedValue([explanation]);
  });

  it("shows three facts first and independently collapses interpretation", async () => {
    render(
      <UnderstandingPanel
        embedded
        projectId="project-1"
        playbackCutoffMs={1326000}
        sourceVersion={null}
        translationVersion={null}
        onPrepareSubtitles={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("事实一：报告提出了新的验证问题。")).toBeInTheDocument();
    expect(screen.queryByText("事实四：后续仍需要检查结果。")).not.toBeInTheDocument();

    const factsToggle = screen.getByRole("button", { name: "展开全部" });
    expect(factsToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(factsToggle);
    expect(factsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("事实四：后续仍需要检查结果。")).toBeInTheDocument();

    const interpretationToggle = screen.getByRole("button", {
      name: "收起",
    });
    expect(interpretationToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(interpretationToggle);
    expect(interpretationToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("这可能意味着团队正在重新评估自动化任务的边界。"),
    ).not.toBeVisible();
  });
});
