import type { SummaryChunk, SummaryTaskStatus } from "./types";

const taskLabels: Record<SummaryTaskStatus, string> = {
  prepared: "材料已准备", awaiting_external_result: "等待返回结果", queued: "等待处理",
  running: "正在处理", paused: "已暂停", validating: "正在检查结果", completed: "总结已完成",
  failed: "处理失败", cancelled: "已取消", interrupted: "处理已中断",
};
const stageLabels: Record<string, string> = {
  ...taskLabels, analyzing_chunks: "正在分析字幕片段", synthesizing: "正在整理总结",
  synthesizing_summary: "正在整理总结", merging: "正在整合结果", cancelling: "正在停止总结",
  awaiting_confirmation: "等待确认发送清单",
};
const chunkLabels: Record<SummaryChunk["status"], string> = {
  prepared: "待处理", queued: "等待处理", running: "正在分析", completed: "已校验", failed: "未完成", cancelled: "已取消",
};
export function summaryStageLabel(stage: string) { return stageLabels[stage] ?? "正在处理"; }
export function summaryChunkLabel(status: string) { return chunkLabels[status as SummaryChunk["status"]] ?? "状态待更新"; }
