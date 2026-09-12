import validate from "../../generated/video-summary.validator.mjs";
import type { VideoSummary } from "./types";
export function parseVideoSummary(value: unknown, expected: { summaryId?: string; projectId?: string } = {}): VideoSummary {
  if (!validate(value) || !value.id.trim() || !value.projectId.trim() || !value.taskId.trim() || !value.subtitleVersionId.trim() ||
    (expected.summaryId !== undefined && value.id !== expected.summaryId) ||
    (expected.projectId !== undefined && value.projectId !== expected.projectId)) throw new Error("总结结果格式无效或与当前请求不匹配。");
  const result = value.result;
  if (new Set(result.coveredChunkOrdinals).size !== result.coveredChunkOrdinals.length) throw new Error("总结结果包含重复的分段覆盖记录。");
  const sections = [...result.speakerNarrative, ...result.timeline, ...result.coreConcepts, ...result.principlesOrArchitecture,
    ...result.examplesAndScenarios, ...result.designTradeoffs, ...result.conclusions];
  const citations = [...sections.flatMap(section => section.evidence.flatMap(evidence => evidence.citations ?? [])),
    ...result.glossary.flatMap(entry => entry.citations ?? [])];
  if (citations.some(citation => citation.endMs < citation.startMs)) throw new Error("总结证据的时间范围无效。");
  return value;
}
export function parseVideoSummaries(value: unknown, projectId: string): VideoSummary[] {
  if (!Array.isArray(value)) throw new Error("总结历史列表格式无效。");
  const summaries = value.map(summary => parseVideoSummary(summary, { projectId }));
  if (new Set(summaries.map(summary => summary.id)).size !== summaries.length) throw new Error("总结历史列表包含重复结果。");
  return summaries;
}
