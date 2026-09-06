import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SummaryResultView } from "./SummaryResultView";
import type { VideoSummary } from "./types";

const summary: VideoSummary = {
  id: "summary-1",
  taskId: "task-1",
  projectId: "project-1",
  protocolVersion: "siaovplay-summary-v1",
  scope: "current_progress",
  playbackCutoffMs: 1_600_000,
  analysisMode: "science_technology",
  subtitleVersionId: "subtitle-1",
  materialManifestSha256: "a".repeat(64),
  visualMaterialUsed: false,
  createdAtMs: 1,
  updatedAtMs: 1,
  result: {
    formatVersion: 2,
    title: "上下文记忆的工作原理",
    overview: "讲者详细解释了即时状态与外部记忆之间的关系。",
    coveredChunkOrdinals: [1],
    speakerNarrative: [],
    timeline: [],
    coreConcepts: [],
    principlesOrArchitecture: [{
      title: "状态压缩",
      body: "每层把上下文转换成下一层可使用的状态。",
      evidence: [
        { kind: "video_statement", claim: "这是讲者的明确表述。", subtitleIds: ["private-uuid"], frameTimestampsMs: [], citations: [{ startMs: 194_000, endMs: 198_000, subtitleCount: 2, excerpt: "层间状态会继续传递。" }] },
        { kind: "ai_inference", claim: "这可能为外部记忆铺垫。", subtitleIds: [], frameTimestampsMs: [], citations: [] },
      ],
    }],
    examplesAndScenarios: [],
    designTradeoffs: [],
    conclusions: [],
    limitations: ["尚未进行外部事实检索。"],
    glossary: [{ term: "状态", explanation: "层间传递的信息表示。", subtitleIds: ["private-uuid"], citations: [] }],
    mermaid: "flowchart LR\nA-->B",
  },
};

describe("SummaryResultView", () => {
  it("keeps video claims, evidence, inference and limitations visibly separate", () => {
    const onExport = vi.fn();
    const onJump = vi.fn();
    const onPausePlayback = vi.fn();
    const { container } = render(<SummaryResultView summary={summary} exporting={false} exportNotice={null} onExport={onExport} onNewSummary={vi.fn()} onJump={onJump} onPausePlayback={onPausePlayback} />);
    expect(screen.getByText("视频明确陈述")).toBeInTheDocument();
    expect(screen.getByText("AI 推导")).toBeInTheDocument();
    expect(screen.getByText(/03:14–03:18/)).toBeInTheDocument();
    expect(screen.queryByText(/private-uuid/)).not.toBeInTheDocument();
    expect(screen.getByText("尚未进行外部事实检索。")).toBeInTheDocument();
    expect(screen.getByText("A → B")).toBeInTheDocument();
    expect(screen.queryByText(/flowchart/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/03:14–03:18/));
    expect(onPausePlayback).toHaveBeenCalledOnce();
    expect(onJump).toHaveBeenCalledWith(194_000);
    fireEvent.click(screen.getByRole("button", { name: "展开阅读" }));
    expect(container.querySelector(".summary-reader-expanded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存 Markdown 报告" }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("keeps a legacy result readable when citations are absent", () => {
    const legacy = structuredClone(summary);
    legacy.result.formatVersion = 1;
    delete legacy.result.principlesOrArchitecture[0].evidence[0].citations;
    render(<SummaryResultView summary={legacy} exporting={false} exportNotice={null} onExport={vi.fn()} onNewSummary={vi.fn()} />);
    expect(screen.getByText("1 条字幕证据")).toBeInTheDocument();
    expect(screen.queryByText(/private-uuid/)).not.toBeInTheDocument();
  });
});
