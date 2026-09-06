import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createSummaryFixtures } from "../../test-fixtures/summary";
import { SummaryProgress } from "./SummaryProgress";
import { summaryChunkLabel, summaryStageLabel } from "./summaryStatus";

it("shows Chinese task and chunk states instead of internal enums", () => {
  const { task } = createSummaryFixtures();
  render(<SummaryProgress task={task} busy={false} onCancel={vi.fn()} onResume={vi.fn()} onOpenMaterials={vi.fn()} />);
  expect(screen.getByText(/正在分析字幕片段/)).toBeInTheDocument();
  expect(screen.queryByText(/analyzing_chunks|^prepared$|^running$/)).not.toBeInTheDocument();
});

it("covers all persisted states and uses a readable fallback for new states", () => {
  for (const state of ["prepared", "awaiting_external_result", "queued", "running", "paused", "validating", "completed", "failed", "cancelled", "interrupted", "analyzing_chunks", "synthesizing"]) {
    expect(summaryStageLabel(state)).toMatch(/[\u4e00-\u9fff]/);
  }
  for (const state of ["prepared", "queued", "running", "completed", "failed", "cancelled"]) expect(summaryChunkLabel(state)).toMatch(/[\u4e00-\u9fff]/);
  expect(summaryStageLabel("unknown_stage")).toBe("正在处理");
  expect(summaryChunkLabel("unknown_state")).toBe("状态待更新");
});

it("shows actual cancellation progress without promising another full request", () => {
  const { task } = createSummaryFixtures();
  render(<SummaryProgress task={{ ...task, cancelRequested: true }} busy={false} onCancel={vi.fn()} onResume={vi.fn()} onOpenMaterials={vi.fn()} />);
  expect(screen.getByRole("button", { name: "正在停止总结" })).toBeDisabled();
});
