import schema from "../../contracts/transcription-job.schema.json";
import { beforeEach, expect, it, vi } from "vitest";
import { getTranscriptionJob, startTranscription, listTranscriptionJobs, cancelTranscriptionJob, resumeTranscriptionJob } from "./transcriptionGateway";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const job = { id: "job", projectId: "project", status: "queued", stage: "queued", progress: 0,
  languageCode: "en", modelKind: "small", runtimeBackend: "cpu", runtimeVersion: "test", subtitleVersionId: null,
  errorCode: null, errorMessage: null, createdAtMs: 1, updatedAtMs: 1, startedAtMs: null, completedAtMs: null };
beforeEach(() => { invoke.mockReset(); });
it.each([
  { status: "unknown" }, { progress: -1 }, { progress: 1.1 }, { languageCode: "zh" },
  { modelKind: "unknown" }, { runtimeBackend: "cuda" }, { createdAtMs: Number.MAX_SAFE_INTEGER + 1 },
  { startedAtMs: "today" }, { errorCode: undefined }, { id: "other" },
])("rejects malformed or unrelated job response %j", async patch => {
  invoke.mockResolvedValue({ ...job, ...patch });
  await expect(getTranscriptionJob("job")).rejects.toThrow();
});
it("checks mutation and list response identities", async () => {
  invoke.mockResolvedValue({ ...job, projectId: "other" });
  await expect(startTranscription("project", "en")).rejects.toThrow();
  invoke.mockResolvedValue({ ...job, id: "other" });
  await expect(cancelTranscriptionJob("job")).rejects.toThrow();
  await expect(resumeTranscriptionJob("job")).rejects.toThrow();
  invoke.mockResolvedValue([{ ...job, projectId: "other" }]);
  await expect(listTranscriptionJobs("project")).rejects.toThrow();
});
it("preserves all request parameters for valid responses", async () => {
  invoke.mockResolvedValue(job);
  await expect(startTranscription("project", "en", "small", true)).resolves.toEqual(job);
  expect(invoke).toHaveBeenLastCalledWith("start_transcription", { input: { projectId: "project", languageCode: "en", modelKind: "small", confirmReplaceOriginal: true } });
  await getTranscriptionJob("job"); await cancelTranscriptionJob("job"); await resumeTranscriptionJob("job");
  invoke.mockResolvedValue([job]);
  await expect(listTranscriptionJobs("project")).resolves.toEqual([job]);
});

it.each(schema.examples)("accepts actual Rust serialized job sample %#", async wire => {
  invoke.mockResolvedValue(wire);
  await expect(getTranscriptionJob(wire.id)).resolves.toEqual(wire);
});
it("rejects start-language/model drift and malformed or duplicate lists", async () => {
  for (const patch of [{ languageCode: "ja" }, { modelKind: "base" }]) {
    invoke.mockResolvedValue({ ...job, ...patch });
    await expect(startTranscription("project", "en", "small")).rejects.toThrow();
  }
  for (const response of [null, {}, [job, job], [{ ...job, progress: Number.NaN }]]) {
    invoke.mockResolvedValue(response);
    await expect(listTranscriptionJobs("project")).rejects.toThrow();
  }
});
