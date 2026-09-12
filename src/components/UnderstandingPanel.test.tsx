import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Explanation } from "../types";

const desktopMocks = vi.hoisted(() => ({
  getCodexRuntimeStatus: vi.fn(),
  getExplanationTask: vi.fn(),
  listExplanationTasks: vi.fn(),
  listExplanations: vi.fn(),
}));
const analysisMocks = vi.hoisted(() => ({
  listAnalysisPromptTemplates: vi.fn(),
}));

vi.mock("../lib/desktop", () => ({
  ...desktopMocks,
  commandError: (error: unknown) => ({
    code: "test_error",
    message: error instanceof Error ? error.message : String(error),
  }),
}));
vi.mock("../features/analysis/gateway", () => ({
  ...analysisMocks,
  saveAnalysisPromptTemplate: vi.fn(),
  deleteAnalysisPromptTemplate: vi.fn(),
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
  protocolVersion: "siaovplay-understanding-v2",
  materialSummary: {
    subtitleCount: 24,
    frameCount: 6,
    startMs: 1146000,
    endMs: 1326000,
  },
  confirmedFacts: [
    "事实一：报告提出了新的验证问题。",
    "事实二：说话者承认目前证据还不完整。",
    "事实三：现场展示了报告中的工作流程。",
    "事实四：后续仍需要检查结果。",
    "事实五：讲者标记了一个限制。",
    "事实六：画面显示了流程图。",
  ].map((text, index) => ({
    text,
    subtitleSegmentIds: [`segment-${index}`],
    frameIds: [],
  })),
  possibleInterpretations: [
    "这可能意味着团队正在重新评估自动化任务的边界。",
    "这里可能在强调证据质量。",
    "工作流程可能仍在试验阶段。",
    "限制说明可能影响最终结论。",
    "流程图可能用于澄清责任边界。",
    "讲者可能希望听众保持谨慎。",
  ].map((text, index) => ({
    text,
    subtitleSegmentIds: [`segment-${index}`],
    frameIds: [],
  })),
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
    analysisMocks.listAnalysisPromptTemplates.mockResolvedValue([
      {
        id: "builtin:understanding:balanced",
        taskType: "understanding",
        baseTemplateId: "builtin:understanding:balanced",
        name: "均衡解释",
        customRequirements: "均衡理解",
        isBuiltin: true,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
  });

  it("shows five items first and independently expands both result groups", async () => {
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
    expect(screen.queryByText("事实六：画面显示了流程图。")).not.toBeInTheDocument();

    const [factsToggle, interpretationToggle] = screen.getAllByRole("button", { name: "展开全部" });
    expect(factsToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(factsToggle);
    expect(factsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("事实六：画面显示了流程图。")).toBeInTheDocument();

    expect(interpretationToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(interpretationToggle);
    expect(interpretationToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("讲者可能希望听众保持谨慎。")).toBeInTheDocument();
  });

  it("never falls back to an explanation after the current playback point", async () => {
    desktopMocks.listExplanations.mockResolvedValue([
      {
        ...explanation,
        id: "future-explanation",
        playbackCutoffMs: explanation.playbackCutoffMs + 60_000,
        confirmedFacts: [{ text: "未来剧情不应显示。", subtitleSegmentIds: [], frameIds: [] }],
      },
    ]);

    render(
      <UnderstandingPanel
        embedded
        projectId="project-1"
        playbackCutoffMs={explanation.playbackCutoffMs}
        sourceVersion={null}
        translationVersion={null}
        onPrepareSubtitles={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("需要先准备原文字幕"),
    ).toBeInTheDocument();
    expect(screen.queryByText("未来剧情不应显示。")).not.toBeInTheDocument();
  });

  it("hides a previously visible explanation after the viewer rewinds", async () => {
    const view = render(
      <UnderstandingPanel
        embedded
        projectId="project-1"
        playbackCutoffMs={explanation.playbackCutoffMs}
        sourceVersion={null}
        translationVersion={null}
        onPrepareSubtitles={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("事实一：报告提出了新的验证问题。"),
    ).toBeInTheDocument();

    view.rerender(
      <UnderstandingPanel
        embedded
        projectId="project-1"
        playbackCutoffMs={explanation.playbackCutoffMs - 1}
        sourceVersion={null}
        translationVersion={null}
        onPrepareSubtitles={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("需要先准备原文字幕"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("事实一：报告提出了新的验证问题。"),
    ).not.toBeInTheDocument();
  });

  it("excludes future explanations from the visible history", async () => {
    desktopMocks.listExplanations.mockResolvedValue([
      {
        ...explanation,
        id: "future-explanation",
        playbackCutoffMs: explanation.playbackCutoffMs + 1,
        confirmedFacts: [{ text: "未来剧情不应出现在历史中。", subtitleSegmentIds: [], frameIds: [] }],
      },
      explanation,
      {
        ...explanation,
        id: "earlier-explanation",
        playbackCutoffMs: explanation.playbackCutoffMs - 60_000,
        confirmedFacts: [{ text: "更早的剧情。", subtitleSegmentIds: [], frameIds: [] }],
      },
    ]);

    render(
      <UnderstandingPanel
        embedded
        projectId="project-1"
        playbackCutoffMs={explanation.playbackCutoffMs}
        sourceVersion={null}
        translationVersion={null}
        onPrepareSubtitles={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("此前理解 · 2")).toBeInTheDocument();
    expect(
      screen.queryByText("未来剧情不应出现在历史中。"),
    ).not.toBeInTheDocument();
  });
});
