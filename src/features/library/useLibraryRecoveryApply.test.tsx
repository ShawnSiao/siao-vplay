import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLibraryRecoveryApply, type RecoveryApplySnapshot } from "./useLibraryRecoveryApply";

const mocks = vi.hoisted(() => ({ applyLibraryRescan: vi.fn(), applyLibraryRootRebuild: vi.fn(), applyLibraryRootRelocation: vi.fn() }));
vi.mock("./libraryGateway", () => mocks);
beforeEach(() => { vi.resetAllMocks(); });
const cases = [
  { action: "applyRescan", stage: "rescan_preview", backend: "applyLibraryRescan", committed: "rescanCommitted" },
  { action: "applyRebuild", stage: "rebuild_preview", backend: "applyLibraryRootRebuild", committed: "rebuildCommitted" },
  { action: "applyRootRelocation", stage: "relocation_preview", backend: "applyLibraryRootRelocation", committed: "relocationCommitted" },
] as const;
const snapshot = (stage: RecoveryApplySnapshot["stage"]) => ({
  stage, rescanPreview: { previewToken: "scan" }, rebuildPreview: { previewToken: "rebuild" }, relocationPreview: { previewToken: "move" },
  newItems: [], rebuildCollectionTitle: "Series", confirmMissing: true, confirmChanged: false, confirmUncertainMatches: false, confirmFingerprintDuplicates: false,
}) as unknown as RecoveryApplySnapshot;
const events = () => ({ started: vi.fn(), rescanCommitted: vi.fn(), rebuildCommitted: vi.fn(), relocationCommitted: vi.fn(), failed: vi.fn(), refreshFailed: vi.fn() });

it("keeps the lock across rerenders and until committed view work settles", async () => {
  let complete!: () => void;
  mocks.applyLibraryRescan.mockResolvedValue({});
  const callbacks = events();
  callbacks.rescanCommitted.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  const hook = renderHook(({ stage }) => useLibraryRecoveryApply(snapshot(stage), callbacks), { initialProps: { stage: "rescan_preview" as RecoveryApplySnapshot["stage"] } });
  let pending!: Promise<unknown>;
  await act(async () => { pending = hook.result.current.applyRescan(); await Promise.resolve(); });
  hook.rerender({ stage: "relocation_preview" });
  await act(async () => { expect(await hook.result.current.applyRootRelocation()).toBeNull(); });
  expect(mocks.applyLibraryRootRelocation).not.toHaveBeenCalled();
  await act(async () => { complete(); await pending; });
});

it.each(cases)("blocks repeated $action while the first confirmation is pending", async item => {
  let complete!: (value: unknown) => void;
  mocks[item.backend].mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const callbacks = events();
  const hook = renderHook(() => useLibraryRecoveryApply(snapshot(item.stage), callbacks));
  let first!: Promise<unknown>, second!: Promise<unknown>;
  act(() => { first = hook.result.current[item.action](); second = hook.result.current[item.action](); });
  expect(mocks[item.backend]).toHaveBeenCalledTimes(1);
  await act(async () => { complete({}); await Promise.all([first, second]); });
  expect(callbacks[item.committed]).toHaveBeenCalledTimes(1);
});
it.each(cases)("preserves committed $action result when view refresh fails", async item => {
  mocks[item.backend].mockResolvedValue({ completed: true });
  const callbacks = events();
  callbacks[item.committed].mockRejectedValue(new Error("refresh"));
  const hook = renderHook(() => useLibraryRecoveryApply(snapshot(item.stage), callbacks));
  await act(async () => { expect(await hook.result.current[item.action]()).toEqual({ completed: true }); });
  expect(callbacks.failed).not.toHaveBeenCalled();
  expect(callbacks.refreshFailed).toHaveBeenCalledWith(expect.stringContaining("已完成"));
});
it.each(cases)("allows retry after $action backend failure without changing the draft", async item => {
  mocks[item.backend].mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce({});
  const callbacks = events();
  const draft = snapshot(item.stage);
  const hook = renderHook(() => useLibraryRecoveryApply(draft, callbacks));
  await act(async () => { expect(await hook.result.current[item.action]()).toBeNull(); });
  expect(callbacks.failed).toHaveBeenCalledWith("disk full");
  expect(callbacks[item.committed]).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current[item.action](); });
  expect(mocks[item.backend].mock.calls[1]).toEqual(mocks[item.backend].mock.calls[0]);
  expect(draft).toEqual(snapshot(item.stage));
});
