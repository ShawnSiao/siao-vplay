import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useResourceMove } from "./useResourceMove";

const mocks = vi.hoisted(() => ({ move: vi.fn(), invoke: vi.fn() }));
vi.mock("../../lib/desktop", () => ({ moveLocalResourceRoot: mocks.move }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => vi.resetAllMocks());

it("cancels the same request and ignores an acknowledgement after completion", async () => {
  let finishMove!: () => void;
  let acknowledge!: (accepted: boolean) => void;
  mocks.move.mockReturnValue(new Promise<void>((resolve) => { finishMove = resolve; }));
  mocks.invoke.mockReturnValue(new Promise<boolean>((resolve) => { acknowledge = resolve; }));
  const onMoved = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useResourceMove(onMoved, vi.fn()));
  let moving!: Promise<unknown>;
  act(() => { moving = result.current.move("W:\\Resources"); });
  const requestId = mocks.move.mock.calls[0][1];
  expect(result.current.moving).toBe(true);
  await expect(result.current.move("W:\\Other")).rejects.toThrow("已有资源复制");
  let cancelling!: Promise<boolean>;
  act(() => { cancelling = result.current.cancel(); });
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_local_resource_move", { requestId });
  await act(async () => { finishMove(); await moving; });
  await act(async () => { acknowledge(true); await cancelling; });
  expect(result.current.moving).toBe(false);
  expect(result.current.cancelling).toBe(false);
  expect(onMoved).toHaveBeenCalledOnce();
});

it("keeps failure available for recovery and releases request ownership", async () => {
  const failure = { code: "local_resource_move_cancelled" };
  mocks.move.mockRejectedValue(failure);
  const onError = vi.fn();
  const onMoved = vi.fn();
  const { result } = renderHook(() => useResourceMove(onMoved, onError));
  await act(async () => { await expect(result.current.move("W:\\Resources")).rejects.toBe(failure); });
  expect(onError).toHaveBeenCalledWith(failure);
  expect(onMoved).not.toHaveBeenCalled();
  expect(result.current.moving).toBe(false);
  expect(await result.current.cancel()).toBe(false);
});
