import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubtitleVersion } from "../../types";
import { createSummaryFixtures } from "../../test-fixtures/summary";

const gateway = vi.hoisted(() => ({
  getVideoSummary: vi.fn(),
  getSummaryTask: vi.fn(),
  listSummaryTasks: vi.fn(),
  listVideoSummaries: vi.fn(),
  prepareSummaryTask: vi.fn(),
  startSummaryTask: vi.fn(),
  resumeSummaryTask: vi.fn(),
  cancelSummaryTask: vi.fn(),
  previewSummaryDispatch: vi.fn(),
  chooseSummaryExportDirectory: vi.fn(),
  exportVideoSummary: vi.fn(),
}));

vi.mock("./gateway", () => ({
  ...gateway,
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
import { getCodexRuntimeStatus } from "../../lib/desktop";

describe("VideoSummaryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway.listSummaryTasks.mockResolvedValue([]);
    gateway.listVideoSummaries.mockResolvedValue([]);
    const { task } = createSummaryFixtures();
    gateway.prepareSummaryTask.mockResolvedValue({ ...task, status: "prepared" });
    gateway.startSummaryTask.mockResolvedValue(task);
    gateway.previewSummaryDispatch.mockResolvedValue({
      taskId: task.id, confirmationSha256: "confirmed-hash", executionKind: "codex",
      receiver: "OpenAI（经本机 Codex）", endpoint: null, model: "Codex 默认模型",
      scope: "current_progress", playbackCutoffMs: 1_600_000,
      subtitleVersionId: "subtitle-1", subtitleVersionNumber: 3, subtitleRole: "original",
      subtitleLanguage: "en", segmentCount: 120, firstStartMs: 0, lastEndMs: 1_602_000,
      promptTemplate: "自动判断", oneTimeRequirements: "", frames: [],
    });
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
    fireEvent.click(await screen.findByRole("button", { name: "准备并查看发送清单" }));
    await waitFor(() => expect(gateway.prepareSummaryTask).toHaveBeenCalledWith(expect.objectContaining({
      scope: "current_progress",
      playbackCutoffMs: 1_600_000,
      executionKind: "codex",
      subtitlesAuthorized: true,
      visualMaterialAuthorized: true,
    })));
    expect(gateway.startSummaryTask).not.toHaveBeenCalled();
    expect(await screen.findByText("OpenAI（经本机 Codex）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认发送并开始" }));
    await waitFor(() => expect(gateway.startSummaryTask).toHaveBeenCalledWith("summary-task-1", "confirmed-hash"));
    expect(await screen.findByText("已完成 3 / 7 段")).toBeInTheDocument();
  });

  it("restores a failed task with an explicit retry action", async () => {
    vi.mocked(getCodexRuntimeStatus).mockRejectedValueOnce(new Error("detection unavailable"));
    const { task } = createSummaryFixtures();
    gateway.listSummaryTasks.mockResolvedValue([{ ...task, status: "failed", errorMessage: "连接中断" }]);
    gateway.resumeSummaryTask.mockResolvedValue(task);
    render(<VideoSummaryPanel projectId="project-1" playbackCutoffMs={1_000} durationMs={5_000}
      sourceVersion={{ id: "subtitle-1" } as SubtitleVersion} translationVersion={null} onPrepareSubtitles={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "继续总结" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认发送并开始" }));
    await waitFor(() => expect(gateway.resumeSummaryTask).toHaveBeenCalledWith(task.id, "confirmed-hash"));
  });

  it("retains prepared materials when starting fails and can retry without preparing again", async () => {
    gateway.startSummaryTask.mockRejectedValueOnce(new Error("暂时不能启动"));
    const { task } = createSummaryFixtures();
    gateway.resumeSummaryTask.mockResolvedValue(task);
    render(<VideoSummaryPanel projectId="project-1" playbackCutoffMs={1_000} durationMs={5_000}
      sourceVersion={{ id: "subtitle-1" } as SubtitleVersion} translationVersion={null} onPrepareSubtitles={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "准备并查看发送清单" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认发送并开始" }));
    expect(await screen.findByText("暂时不能启动")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始总结" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认发送并开始" }));
    await waitFor(() => expect(gateway.resumeSummaryTask).toHaveBeenCalledWith(task.id, "confirmed-hash"));
    expect(gateway.prepareSummaryTask).toHaveBeenCalledTimes(1);
  });

it("retries a failed completed-result read without sending another task", async () => {
  const { task, summary } = createSummaryFixtures();
  gateway.listSummaryTasks.mockResolvedValue([]);
  gateway.listVideoSummaries.mockResolvedValue([]);
  gateway.startSummaryTask.mockResolvedValue({ ...task, status: "completed", outputSummaryId: summary.id });
  gateway.getVideoSummary.mockRejectedValueOnce(new Error("读取暂时失败")).mockResolvedValue(summary);
  render(<VideoSummaryPanel projectId="project-1" playbackCutoffMs={1_600_000} durationMs={5_200_000}
    sourceVersion={{ id: "subtitle-1" } as SubtitleVersion} translationVersion={null} onPrepareSubtitles={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "准备并查看发送清单" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认发送并开始" }));
  expect(await screen.findByText("读取暂时失败")).toBeInTheDocument();
  const sends = gateway.startSummaryTask.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "重新读取总结" }));
  expect(await screen.findByRole("heading", { name: summary.result.title })).toBeInTheDocument();
  expect(gateway.getVideoSummary).toHaveBeenCalledTimes(2);
  expect(gateway.startSummaryTask).toHaveBeenCalledTimes(sends);
});

});

it.each(["cancelled", "running"] as const)("preserves %s cancellation acknowledgement against a batched old poll", async (status) => {
  const { task } = createSummaryFixtures();
  let finishPoll!: (value: typeof task) => void;
  let finishCancel!: (value: typeof task) => void;
  gateway.listSummaryTasks.mockResolvedValue([task]);
  gateway.listVideoSummaries.mockResolvedValue([]);
  gateway.getSummaryTask.mockImplementation(() => new Promise(resolve => { finishPoll = resolve; }));
  gateway.cancelSummaryTask.mockImplementation(() => new Promise(resolve => { finishCancel = resolve; }));
  render(<VideoSummaryPanel projectId={task.projectId} playbackCutoffMs={1_000} durationMs={5_000}
    sourceVersion={{ id: "subtitle-1" } as SubtitleVersion} translationVersion={null} onPrepareSubtitles={vi.fn()} />);
  await waitFor(() => expect(finishPoll).toBeTypeOf("function"), { timeout: 2500 });
  fireEvent.click(screen.getByRole("button", { name: "取消总结" }));
  await act(async () => {
    finishCancel({ ...task, status, stage: status === "cancelled" ? "cancelled" : "cancelling", cancelRequested: true });
    await Promise.resolve();
    finishPoll(task);
    await Promise.resolve();
  });
  if (status === "cancelled") expect(screen.queryByRole("heading", { name: "正在分析视频内容" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "取消总结" })).not.toBeInTheDocument();
  if (status === "cancelled") expect(screen.getByText(/已取消/)).toBeInTheDocument();
  else {
    expect(screen.getByRole("button", { name: "正在停止总结" })).toBeDisabled();
    const previousPoll = finishPoll;
    await waitFor(() => expect(finishPoll).not.toBe(previousPoll), { timeout: 2500 });
    await act(async () => finishPoll({ ...task, status: "cancelled", stage: "cancelled", cancelRequested: true }));
    expect(screen.getByText(/已取消/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "正在停止总结" })).not.toBeInTheDocument();
  }
});


it("shows uncertain export status without success or automatic repeat export", async () => {
  const { task, summary } = createSummaryFixtures();
  gateway.listSummaryTasks.mockResolvedValue([{ ...task, status: "completed", outputSummaryId: summary.id }]);
  gateway.listVideoSummaries.mockResolvedValue([summary]);
  gateway.chooseSummaryExportDirectory.mockResolvedValue("W:/reports");
  gateway.exportVideoSummary.mockReset().mockRejectedValue(new Error("报告导出已返回，但保存结果尚未确认。请先检查所选目录，避免重复导出。"));
  render(<VideoSummaryPanel projectId="project-1" playbackCutoffMs={1_000} durationMs={5_000}
    sourceVersion={{ id: "subtitle-1" } as SubtitleVersion} translationVersion={null} onPrepareSubtitles={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "保存 Markdown 报告" }));
  expect(await screen.findByText(/保存结果尚未确认/)).toBeInTheDocument();
  expect(screen.queryByText(/报告已保存/)).not.toBeInTheDocument();
  expect(gateway.exportVideoSummary).toHaveBeenCalledTimes(1);
});
