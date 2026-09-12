import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useLibraryMutation } from "./useLibraryMutation";

it("rejects a second submission before the pending mutation settles", async () => {
  let complete!: (value: number) => void;
  const operation = vi.fn(() => new Promise<number>(resolve => { complete = resolve; }));
  const apply = vi.fn(), dispatch = vi.fn(), refresh = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useLibraryMutation(dispatch, refresh));
  let first!: Promise<unknown>, second!: Promise<unknown>;
  act(() => { first = hook.result.current(operation, apply); second = hook.result.current(operation, apply); });
  expect(operation).toHaveBeenCalledTimes(1);
  await act(async () => { complete(1); await Promise.all([first, second]); });
  expect(apply).toHaveBeenCalledTimes(1);
});

it("releases pending state after an application callback fails without losing the committed result", async () => {
  const dispatch = vi.fn(), refresh = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useLibraryMutation(dispatch, refresh));
  await act(async () => {
    expect(await hook.result.current(async () => 42, () => { throw new Error("view"); })).toBe(42);
  });
  expect(dispatch).toHaveBeenCalledWith({ type: "mutation_finished" });
  expect(dispatch).toHaveBeenCalledWith({ type: "failed", message: expect.stringContaining("已完成") });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("releases the lock after a backend failure and permits retry", async () => {
  const dispatch = vi.fn(), refresh = vi.fn().mockResolvedValue(undefined), apply = vi.fn();
  const operation = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(1);
  const hook = renderHook(() => useLibraryMutation(dispatch, refresh));
  await act(async () => { expect(await hook.result.current(operation, apply)).toBeNull(); });
  expect(apply).not.toHaveBeenCalled();
  await act(async () => { expect(await hook.result.current(operation, apply)).toBe(1); });
  expect(operation).toHaveBeenCalledTimes(2);
});
