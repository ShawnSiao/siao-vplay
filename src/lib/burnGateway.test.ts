import { beforeEach, expect, it, vi } from "vitest";
import { createBurnJobFixture } from "../test-fixtures/burn";
import { getSubtitleBurnJob, listSubtitleBurnJobs, startSubtitleBurn, cancelSubtitleBurnJob, resumeSubtitleBurnJob } from "./desktop";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const job = createBurnJobFixture();
beforeEach(() => { invoke.mockReset(); });
it.each([{ id: "wrong" }, { status: "unknown" }, { progress: 2 }, { mode: "unknown" }, { updatedAtMs: Number.MAX_SAFE_INTEGER + 1 }, { translationVersionId: "" }])("rejects malformed or mismatched jobs %j", async patch => {
  invoke.mockResolvedValue({ ...job, ...patch }); await expect(getSubtitleBurnJob(job.id)).rejects.toThrow();
});
it.each([cancelSubtitleBurnJob, resumeSubtitleBurnJob])("rejects another job after a lifecycle command", async action => {
  invoke.mockResolvedValue({ ...job, id: "other" }); await expect(action(job.id)).rejects.toThrow();
});
it("rejects duplicate and wrong-project history", async () => {
  for (const result of [[job, job], [{ ...job, projectId: "other" }]]) {
    invoke.mockResolvedValue(result); await expect(listSubtitleBurnJobs(job.projectId)).rejects.toThrow();
  }
});
it.each([{ projectId: "other" }, { translationVersionId: "other" }, { mode: "bilingual", sourceVersionId: "source" }])("rejects a start result with a different selection %j", async patch => {
  invoke.mockResolvedValue({ ...job, ...patch });
  await expect(startSubtitleBurn(job.projectId, "translation", null, "translation", "W:\\fixture", { textSize: "medium", positionY: 90 })).rejects.toThrow();
});

it.each(["queued", "running", "validating", "completed", "failed", "cancelled", "interrupted"] as const)("accepts supported state %s in both modes", async status => {
  for (const mode of ["translation", "bilingual"] as const) {
    const value = { ...job, mode, status, sourceVersionId: mode === "bilingual" ? "source" : null,
      ...(status === "completed" ? { outputPath: "fixture.mp4", manifestPath: "fixture.json", outputSha256: "a".repeat(64), progress: 1 } : {}) };
    invoke.mockResolvedValue(value); await expect(getSubtitleBurnJob(job.id)).resolves.toEqual(value);
  }
});
it.each([{ mode: "bilingual", sourceVersionId: null }, { status: "completed" }, { outputSha256: "bad-hash" }, { progress: -1 }, { createdAtMs: 0.5 }])("rejects incomplete output or unsafe job values %j", async patch => {
  invoke.mockResolvedValue({ ...job, ...patch }); await expect(getSubtitleBurnJob(job.id)).rejects.toThrow();
});
it("keeps the selected versions, style and confirmation at start", async () => {
  const value = { ...job, mode: "bilingual", sourceVersionId: "source" };
  invoke.mockResolvedValue(value);
  const style = { textSize: "medium" as const, positionY: 90 };
  await expect(startSubtitleBurn(job.projectId, "bilingual", "source", "translation", "fixture", style)).resolves.toEqual(value);
  expect(invoke).toHaveBeenCalledWith("start_subtitle_burn", { input: { projectId: job.projectId, mode: "bilingual", sourceVersionId: "source",
    translationVersionId: "translation", destinationDirectory: "fixture", style, confirmVersionSelection: true } });
});
it("rejects an unrelated source version from bilingual preparation", async () => {
  invoke.mockResolvedValue({ ...job, mode: "bilingual", sourceVersionId: "other" });
  await expect(startSubtitleBurn(job.projectId, "bilingual", "source", "translation", "fixture", { textSize: "medium", positionY: 90 })).rejects.toThrow();
});
it("accepts an empty history but rejects a non-list response", async () => {
  invoke.mockResolvedValue([]); await expect(listSubtitleBurnJobs(job.projectId)).resolves.toEqual([]);
  invoke.mockResolvedValue(null); await expect(listSubtitleBurnJobs(job.projectId)).rejects.toThrow();
});
