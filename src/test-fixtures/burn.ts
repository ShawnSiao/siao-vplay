import type { SubtitleBurnJob } from "../types";
export function createBurnJobFixture(): SubtitleBurnJob {
  return { id: "burn-job", projectId: "project", status: "queued", stage: "queued", progress: 0,
    mode: "translation", sourceVersionId: null, translationVersionId: "translation", outputPath: null,
    manifestPath: null, outputSha256: null, runtimeVersion: "fixture-ffmpeg", errorCode: null, errorMessage: null,
    createdAtMs: 1, updatedAtMs: 1, startedAtMs: null, completedAtMs: null };
}
