import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { SubtitleVersion } from "../../types";
import { createTranslationTask } from "../../test-fixtures/translation";
import { useTranslationResultRead } from "./useTranslationResultRead";

const task = { ...createTranslationTask("project-1", { id: "source", segments: [{ id: "line" }] }), status: "completed" as const, outputVersionId: "output" };

it("does not repeat a failed read when callbacks or polling objects change", async () => {
  const first = vi.fn().mockRejectedValue(new Error("busy"));
  const next = vi.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(({ value, read }) => useTranslationResultRead(value, [], read), { initialProps: { value: task, read: first } });
  await waitFor(() => expect(result.current.failed).toBe(true));
  rerender({ value: { ...task }, read: next });
  expect(next).not.toHaveBeenCalled();
  act(() => result.current.retry());
  await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
  expect(result.current.failed).toBe(false);
});

it("ignores a late failure belonging to the previous task", async () => {
  let reject!: (cause: Error) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const { result, rerender } = renderHook(({ value }) => useTranslationResultRead(value, [], read), { initialProps: { value: task } });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  rerender({ value: { ...task, id: "next-task", projectId: "next-project" } });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await act(async () => { reject(new Error("old failure")); });
  expect(result.current.failed).toBe(false);
});

it("does not read an output version already loaded in the player", async () => {
  const read = vi.fn();
  renderHook(() => useTranslationResultRead(task, [{ id: "output" } as SubtitleVersion], read));
  await act(async () => {});
  expect(read).not.toHaveBeenCalled();
});
