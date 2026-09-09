import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { SubtitleVersion, TranscriptionJob } from "../../types";
import { useTrackedTranscription } from "./useTrackedTranscription";

const job: TranscriptionJob = {
  id: "job", projectId: "project", status: "completed", stage: "done", progress: 1,
  languageCode: "en", modelKind: "small", runtimeBackend: "cpu", runtimeVersion: "test",
  subtitleVersionId: "version", errorCode: null, errorMessage: null,
  createdAtMs: 1, updatedAtMs: 2, startedAtMs: 1, completedAtMs: 2,
};
const version: SubtitleVersion = {
  id: "version", projectId: "project", trackId: "track", role: "original", versionNumber: 1,
  status: "draft", sourceKind: "transcription", sourceLabel: "test", sourceSha256: "a".repeat(64), mediaSha256: "b".repeat(64),
  languageCode: "en", projectRevision: 1, parentVersionId: null, sourceTaskId: "job", createdAtMs: 2, isCurrent: true, segments: [],
  preflight: { status: "ready", segmentCount: 0, errorCount: 0, warningCount: 0, firstStartMs: null, lastEndMs: null, mediaDurationMs: null, coverageRatio: null, issues: [] },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { resolve, promise };
}
const options = () => ({ jobId: "job", projectId: "project", sessionId: 1, paused: false, versions: [] as SubtitleVersion[],
  getTranscriptionJob: vi.fn(async () => job), getSubtitleVersion: vi.fn(async () => version),
  onVersion: vi.fn(async () => undefined), onFinished: vi.fn(), onNotice: vi.fn(),
});

it("does not restart a slow request when callbacks and known versions are updated", async () => {
  const pending = deferred<TranscriptionJob>(); const base = options();
  base.getTranscriptionJob.mockReturnValue(pending.promise);
  const { rerender } = renderHook(props => useTrackedTranscription(props), { initialProps: base });
  const latest = vi.fn(async () => undefined);
  rerender({ ...base, versions: [], onVersion: latest });
  expect(base.getTranscriptionJob).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(job));
  expect(latest).toHaveBeenCalledTimes(1);
  expect(base.onVersion).not.toHaveBeenCalled();
});

it("does not clear tracking after an asynchronous consumer has outlived its session", async () => {
  const pending = deferred<undefined>(); const base = options();
  base.onVersion.mockReturnValue(pending.promise);
  const { unmount } = renderHook(() => useTrackedTranscription(base));
  await waitFor(() => expect(base.onVersion).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => pending.resolve(undefined));
  expect(base.onFinished).not.toHaveBeenCalled();
});

it("rejects an old response when the same project is reopened in another session", async () => {
  const pending = deferred<TranscriptionJob>(); const base = options();
  base.getTranscriptionJob.mockReturnValueOnce(pending.promise).mockResolvedValue({ ...job, status: "transcribing" });
  const { rerender } = renderHook(props => useTrackedTranscription(props), { initialProps: base });
  rerender({ ...base, sessionId: 2 });
  await act(async () => pending.resolve(job));
  expect(base.getSubtitleVersion).not.toHaveBeenCalled();
  expect(base.onVersion).not.toHaveBeenCalled();
});

it("pauses background reads while the subtitle dialog owns the job", async () => {
  const base = options();
  const { rerender } = renderHook(props => useTrackedTranscription(props), { initialProps: { ...base, paused: true } });
  expect(base.getTranscriptionJob).not.toHaveBeenCalled();
  rerender(base);
  await waitFor(() => expect(base.onFinished).toHaveBeenCalledWith("job"));
  expect(base.onVersion).toHaveBeenCalledTimes(1);
});

it("does not apply an already loaded version twice", async () => {
  const base = options(); base.versions = [version];
  renderHook(() => useTrackedTranscription(base));
  await waitFor(() => expect(base.onFinished).toHaveBeenCalledWith("job"));
  expect(base.onVersion).not.toHaveBeenCalled();
});
