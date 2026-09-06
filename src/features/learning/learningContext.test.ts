import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useLearningContext, type LearningContext } from "./learningContext";

const context = (id: string, position: number): LearningContext => ({
  projectId: "project", playbackPositionMs: position,
  sourceVersion: { id: "original" } as LearningContext["sourceVersion"], translationVersion: null,
  sourceSegment: { id, text: id } as LearningContext["sourceSegment"], translationSegment: null,
});

it("retains the selected sentence and authorization cutoff as playback advances", () => {
  const first = context("first sentence", 1200);
  const { result, rerender } = renderHook(useLearningContext, { initialProps: first });
  rerender(context("next sentence", 5000));
  expect(result.current.context).toBe(first);
  expect(result.current.changed).toBe(true);
  act(() => result.current.selectCurrent());
  expect(result.current.context.sourceSegment?.id).toBe("next sentence");
  expect(result.current.context.playbackPositionMs).toBe(5000);
});

it("does not offer a sentence change merely because the playback clock advances", () => {
  const { result, rerender } = renderHook(useLearningContext, { initialProps: context("same", 1200) });
  rerender(context("same", 1800));
  expect(result.current.changed).toBe(false);
  expect(result.current.context.playbackPositionMs).toBe(1200);
});
