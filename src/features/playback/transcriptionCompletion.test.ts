import { expect, it } from "vitest";
import type { TranscriptionJob } from "../../types";
import { matchesTranscriptionOutput, transcriptionCompletion } from "./transcriptionCompletion";
const job: TranscriptionJob = {
  id: "job", projectId: "project", status: "completed", stage: "done", progress: 100,
  languageCode: "en", modelKind: "small", runtimeBackend: "cpu", runtimeVersion: "test",
  subtitleVersionId: "version", errorCode: null, errorMessage: null,
  createdAtMs: 1, updatedAtMs: 2, startedAtMs: 1, completedAtMs: 2,
};

it.each(["queued", "completed"] as const)("rejects another task's %s response before polling or accepting its output", status => {
  expect(transcriptionCompletion({ ...job, id: "other", status }, "job", "project")).toMatchObject({ kind: "stop", notice: expect.any(String) });
});
it("reports failed and interrupted outcomes after the subtitle dialog has closed", () => {
  for (const status of ["failed", "interrupted"] as const) {
    const result = transcriptionCompletion({ ...job, status, errorMessage: "C:\\private\\audio.wav" }, "job", "project");
    expect(result).toMatchObject({ kind: "stop", notice: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("private");
  }
});
it("rejects a completed task without its promised output", () => {
  expect(transcriptionCompletion({ ...job, subtitleVersionId: null }, "job", "project")).toMatchObject({ kind: "stop", notice: expect.any(String) });
});
it("only accepts the matching original track", () => {
  expect(matchesTranscriptionOutput({ id: "version", projectId: "project", role: "original" }, "version", "project")).toBe(true);
  for (const output of [{ id: "other", projectId: "project", role: "original" }, { id: "version", projectId: "other", role: "original" }, { id: "version", projectId: "project", role: "translation" }] as const) {
    expect(matchesTranscriptionOutput(output, "version", "project")).toBe(false);
  }
});
it("preserves waiting, success and cancellation semantics", () => {
  expect(transcriptionCompletion({ ...job, status: "transcribing" }, "job", "project")).toEqual({ kind: "waiting" });
  expect(transcriptionCompletion(job, "job", "project")).toEqual({ kind: "complete", versionId: "version" });
  expect(transcriptionCompletion({ ...job, status: "cancelled" }, "job", "project")).toMatchObject({ kind: "stop" });
});
