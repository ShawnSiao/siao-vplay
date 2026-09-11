import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { usePlaybackTools } from "./usePlaybackTools";

it("clears all video tools and selected translation segments in a new playback session", () => {
  const { result, rerender } = renderHook(usePlaybackTools, { initialProps: 1 });
  act(() => {
    result.current.setSubtitleDialogOpen(true);
    result.current.setTranslationDialogOpen(true);
    result.current.setRevisionDialogOpen(true);
    result.current.setDeliveryDialogOpen(true);
    result.current.setTranslationSegmentIds(["old-video-segment"]);
  });
  rerender(2);
  expect(result.current).toMatchObject({ subtitleDialogOpen: false, translationDialogOpen: false,
    revisionDialogOpen: false, deliveryDialogOpen: false, translationSegmentIds: undefined });
});

it("ignores an old resource preparation callback before any tool is opened in the new session", () => {
  const { result, rerender } = renderHook(usePlaybackTools, { initialProps: 1 });
  const oldOpen = result.current.setSubtitleDialogOpen;
  rerender(2);
  act(() => oldOpen(true));
  expect(result.current.subtitleDialogOpen).toBe(false);
  act(() => result.current.setDeliveryDialogOpen(true));
  expect(result.current.deliveryDialogOpen).toBe(true);
  expect(result.current.subtitleDialogOpen).toBe(false);
});

it("ignores old close and selection callbacks after the new session opens a tool", () => {
  const { result, rerender } = renderHook(usePlaybackTools, { initialProps: 1 });
  const old = result.current;
  rerender(2);
  act(() => {
    result.current.setTranslationDialogOpen(true);
    result.current.setTranslationSegmentIds(["new-video-segment"]);
  });
  act(() => {
    old.setTranslationDialogOpen(false);
    old.setTranslationSegmentIds(["old-video-segment"]);
  });
  expect(result.current.translationDialogOpen).toBe(true);
  expect(result.current.translationSegmentIds).toEqual(["new-video-segment"]);
});

it("preserves tool state on ordinary renders within the same session", () => {
  const { result, rerender } = renderHook(usePlaybackTools, { initialProps: 1 });
  act(() => result.current.setRevisionDialogOpen(true));
  rerender(1);
  expect(result.current.revisionDialogOpen).toBe(true);
});
