import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubtitleVersion } from "../../types";
import { createSummaryFixtures } from "../../test-fixtures/summary";

const gateway = vi.hoisted(() => ({
  listSummaryTasks: vi.fn(),
  listVideoSummaries: vi.fn(),
  prepareSummaryTask: vi.fn(),
  startSummaryTask: vi.fn(),
  resumeSummaryTask: vi.fn(),
  cancelSummaryTask: vi.fn(),
}));

vi.mock("./gateway", () => ({
  ...gateway,
  chooseSummaryExportDirectory: vi.fn(),
  exportVideoSummary: vi.fn(),
  getSummaryTask: vi.fn(),
  getVideoSummary: vi.fn(),
  openSummaryMaterials: vi.fn(),
}));
vi.mock("../../lib/desktop", () => ({
  commandError: (cause: unknown) => ({ message: cause instanceof Error ? cause.message : String(cause) }),
  getCodexRuntimeStatus: vi.fn().mockResolvedValue({ available: true, authenticated: true, supported: true, version: "test", authMode: "chatgpt", minimumVersion: "1", errorCode: null, errorMessage: null }),
}));
vi.mock("../ai-tasks/useAiExecutionChoice", () => ({
  useAiExecutionChoice: () => ({
    settings: null, services: [], service: null, kind: "codex", serviceId: null,
    modelId: "", frames: true, loading: false, error: null,
    execution: { kind: "codex" },
    authorization: { subtitles: true, currentQuestion: true, frames: true, serviceRevision: null },
    setKind: vi.fn(), selectService: vi.fn(), setModelId: vi.fn(), setFrames: vi.fn(),
    preview: vi.fn().mockResolvedValue({
      execution: { kind: "codex" },
      authorization: { subtitles: true, currentQuestion: true, frames: true, serviceRevision: null },
      preview: { executionKind: "codex", serviceConfigId: null, providerId: null, displayName: "本机 Codex", modelId: null, subtitles: true, currentQuestion: true, framesRequested: true, framesEffective: true, serviceRevision: null },
    }),
  }),
}));
vi.mock("../analysis/gateway", () => ({
  listAnalysisPromptTemplates: vi.fn().mockResolvedValue([{ id: "builtin:summary:automatic", taskType: "summary", baseTemplateId: "builtin:summary:automatic", name: "自动判断", customRequirements: "", isBuiltin: true, createdAtMs: 1, updatedAtMs: 1 }]),
  saveAnalysisPromptTemplate: vi.fn(),
  deleteAnalysisPromptTemplate: vi.fn(),
}));

import { VideoSummaryPanel } from "./VideoSummaryPanel";

describe("VideoSummaryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway.listSummaryTasks.mockResolvedValue([]);
    gateway.listVideoSummaries.mockResolvedValue([]);
    const { task } = createSummaryFixtures();
    gateway.prepareSummaryTask.mockResolvedValue({ ...task, status: "prepared" });
    gateway.startSummaryTask.mockResolvedValue(task);
  });

  it("prepares and starts a background task with the confirmed material scope", async () => {
    render(
      <VideoSummaryPanel
        projectId="project-1"
        playbackCutoffMs={1_600_000}
        durationMs={5_200_000}
        sourceVersion={{ id: "subtitle-1" } as SubtitleVersion}
        translationVersion={null}
        onPrepareSubtitles={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "开始生成总结" }));
    await waitFor(() => expect(gateway.prepareSummaryTask).toHaveBeenCalledWith(expect.objectContaining({
      scope: "current_progress",
      playbackCutoffMs: 1_600_000,
      executionKind: "codex",
      subtitlesAuthorized: true,
      visualMaterialAuthorized: true,
    })));
    expect(gateway.startSummaryTask).toHaveBeenCalledWith("summary-task-1");
    expect(await screen.findByText("已完成 3 / 7 段")).toBeInTheDocument();
  });

  it("restores a failed task with an explicit retry action", async () => {
    const { task } = createSummaryFixtures();
    gateway.listSummaryTasks.mockResolvedValue([{ ...task, status: "failed", errorMessage: "连接中断" }]);
    gateway.resumeSummaryTask.mockResolvedValue(task);
    render(<VideoSummaryPanel projectId="project-1" playbackCutoffMs={1_000} durationMs={5_000}
      sourceVersion={{ id: "subtitle-1" } as SubtitleVersion} translationVersion={null} onPrepareSubtitles={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "继续任务" }));
    await waitFor(() => expect(gateway.resumeSummaryTask).toHaveBeenCalledWith(task.id));
  });

  it("retains prepared materials when starting fails and can retry without preparing again", async () => {
    gateway.startSummaryTask.mockRejectedValueOnce(new Error("暂时不能启动"));
    const { task } = createSummaryFixtures();
    gateway.resumeSummaryTask.mockResolvedValue(task);
    render(<VideoSummaryPanel projectId="project-1" playbackCutoffMs={1_000} durationMs={5_000}
      sourceVersion={{ id: "subtitle-1" } as SubtitleVersion} translationVersion={null} onPrepareSubtitles={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "开始生成总结" }));
    expect(await screen.findByText("暂时不能启动")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始任务" }));
    await waitFor(() => expect(gateway.resumeSummaryTask).toHaveBeenCalledWith(task.id));
    expect(gateway.prepareSummaryTask).toHaveBeenCalledTimes(1);
  });
});
