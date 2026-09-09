import { beforeEach, expect, it, vi } from "vitest";
import { createSummaryFixtures } from "../../test-fixtures/summary";
import { getVideoSummary, listVideoSummaries } from "./gateway";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { summary } = createSummaryFixtures();
beforeEach(() => { invoke.mockReset(); });
it.each([{ id: "wrong" }, { protocolVersion: "unknown" }, { result: null },
  { result: { ...summary.result, formatVersion: 999 } },
  { result: { ...summary.result, timeline: [{ title: "t", body: "b", evidence: [{ kind: "unknown" }] }] } },
  { result: { ...summary.result, coveredChunkOrdinals: [Number.MAX_SAFE_INTEGER + 1] } }])("rejects invalid summary result %j", async patch => {
  invoke.mockResolvedValue({ ...summary, ...patch });
  await expect(getVideoSummary(summary.id)).rejects.toThrow();
});
it("rejects another project's history and duplicate results", async () => {
  for (const value of [null, [summary, summary], [{ ...summary, projectId: "other" }]]) {
    invoke.mockResolvedValue(value);
    await expect(listVideoSummaries(summary.projectId)).rejects.toThrow();
  }
});
it("accepts the current complete result", async () => {
  invoke.mockResolvedValue(summary);
  await expect(getVideoSummary(summary.id)).resolves.toEqual(summary);
});

it("accepts a legacy result with omitted optional citations", async () => {
  const value = { ...summary, result: { ...summary.result, formatVersion: 1,
    timeline: [{ title: "legacy", body: "body", evidence: [{ kind: "video_statement", claim: "claim", subtitleIds: [], frameTimestampsMs: [] }] }] } };
  invoke.mockResolvedValue(value);
  await expect(getVideoSummary(summary.id)).resolves.toEqual(value);
});
it("rejects unsafe frame times, inverted citations and duplicate coverage", async () => {
  for (const result of [
    { ...summary.result, coveredChunkOrdinals: [1, 1] },
    { ...summary.result, timeline: [{ title: "t", body: "b", evidence: [{ kind: "video_statement", claim: "c", subtitleIds: [], frameTimestampsMs: [-1] }] }] },
    { ...summary.result, glossary: [{ term: "t", explanation: "e", subtitleIds: [], citations: [{ startMs: 10, endMs: 1, subtitleCount: 1, excerpt: "e" }] }] },
  ]) {
    invoke.mockResolvedValue({ ...summary, result });
    await expect(getVideoSummary(summary.id)).rejects.toThrow();
  }
});
