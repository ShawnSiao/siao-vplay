import { act, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TranscriptionJob } from "../../types";
import { TrackedTranscriptions } from "./TrackedTranscriptions";

const failedJob = (id: string, projectId: string): TranscriptionJob => ({
  id, projectId, status: "failed", stage: "failed", progress: 0,
  languageCode: "en", modelKind: "small", runtimeBackend: "cpu", runtimeVersion: "test",
  subtitleVersionId: null, errorCode: "test", errorMessage: "test",
  createdAtMs: 1, updatedAtMs: 2, startedAtMs: 1, completedAtMs: 2,
});

it("pauses only the dialog's project and preserves the other poll when a peer is removed", async () => {
  let finishA!: (job: TranscriptionJob) => void;
  let finishB!: (job: TranscriptionJob) => void;
  const pendingA = new Promise<TranscriptionJob>(resolve => { finishA = resolve; });
  const pendingB = new Promise<TranscriptionJob>(resolve => { finishB = resolve; });
  const getTranscriptionJob = vi.fn((id: string) => id === "a" ? pendingA : pendingB);
  const onFinished = vi.fn(), onNotice = vi.fn();
  const jobs = [{ jobId: "a", projectId: "video-a" }, { jobId: "b", projectId: "video-b" }];
  const props = { jobs, projectId: "video-a", sessionId: 1, versions: [],
    getTranscriptionJob, getSubtitleVersion: vi.fn(), onVersion: vi.fn(), onFinished, onNotice };
  const { rerender } = render(<TrackedTranscriptions {...props} pausedProjectId="video-a" />);
  expect(getTranscriptionJob.mock.calls).toEqual([["b"]]);
  rerender(<TrackedTranscriptions {...props} />);
  expect(getTranscriptionJob.mock.calls).toEqual([["b"], ["a"]]);
  await act(async () => finishA(failedJob("a", "video-a")));
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith("a"));
  rerender(<TrackedTranscriptions {...props} jobs={[jobs[1]]} />);
  expect(getTranscriptionJob).toHaveBeenCalledTimes(2);
  await act(async () => finishB(failedJob("b", "video-b")));
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith("b"));
  expect(onNotice).toHaveBeenCalledTimes(2);
  expect(onNotice).toHaveBeenLastCalledWith(expect.stringContaining("对应视频"));
});
