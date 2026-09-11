import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useTranscriptionRegistry } from "./useTranscriptionRegistry";

it("keeps both videos tracked when a second transcription starts", () => {
  const { result } = renderHook(useTranscriptionRegistry);
  act(() => {
    result.current.register("job-a", "video-a");
    result.current.register("job-b", "video-b");
  });
  expect(result.current.jobs).toEqual([
    { jobId: "job-a", projectId: "video-a" }, { jobId: "job-b", projectId: "video-b" },
  ]);
  act(() => result.current.finish("job-a"));
  expect(result.current.jobs).toEqual([{ jobId: "job-b", projectId: "video-b" }]);
  act(() => result.current.finish("job-b"));
  expect(result.current.jobs).toEqual([]);
});

it("repeated registration preserves the job identity and collection reference", () => {
  const { result } = renderHook(useTranscriptionRegistry);
  act(() => result.current.register("job-a", "video-a"));
  const jobs = result.current.jobs;
  act(() => result.current.register("job-a", "video-a"));
  expect(result.current.jobs).toBe(jobs);
  act(() => result.current.finish("unrelated"));
  expect(result.current.jobs).toBe(jobs);
});

it("does not reassign an already tracked job to a different video", () => {
  const { result } = renderHook(useTranscriptionRegistry);
  act(() => result.current.register("job-a", "video-a"));
  act(() => result.current.register("job-a", "video-b"));
  expect(result.current.jobs).toEqual([{ jobId: "job-a", projectId: "video-a" }]);
});
