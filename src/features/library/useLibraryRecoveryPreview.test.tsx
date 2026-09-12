import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLibraryRecoveryPreview } from "./useLibraryRecoveryPreview";

const mocks = vi.hoisted(() => ({ inspectLibraryRescan: vi.fn(), inspectLibraryRootRebuild: vi.fn(), inspectLibraryRootRelocation: vi.fn() }));
vi.mock("./libraryGateway", () => mocks);
beforeEach(() => { vi.resetAllMocks(); });

it.each(["rescan", "rebuild", "relocation"].flatMap(operation => [false, true].map(failure => ({ operation, failure }))))("ignores $operation responses after unmount (failure=$failure)", async ({ operation, failure }) => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const backend = operation === "rescan" ? mocks.inspectLibraryRescan : operation === "rebuild" ? mocks.inspectLibraryRootRebuild : mocks.inspectLibraryRootRelocation;
  backend.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const dispatch = vi.fn();
  const hook = renderHook(() => useLibraryRecoveryPreview(dispatch));
  let pending!: Promise<unknown>;
  act(() => {
    pending = operation === "rescan" ? hook.result.current.inspectRootRescan("root")
      : operation === "rebuild" ? hook.result.current.inspectRootRebuild("root")
      : hook.result.current.inspectRootRelocation("root", "W:/media");
  });
  hook.unmount();
  dispatch.mockClear();
  await act(async () => {
    if (failure) reject(new Error("late error"));
    else resolve({ newCandidates: [] });
    await pending;
  });
  expect(dispatch).not.toHaveBeenCalled();
});

it("invalidates a previous preview when another recovery operation starts or closes", async () => {
  let resolve!: (value: unknown) => void;
  mocks.inspectLibraryRescan.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  mocks.inspectLibraryRootRelocation.mockResolvedValue({ rootId: "second" });
  const dispatch = vi.fn();
  const hook = renderHook(() => useLibraryRecoveryPreview(dispatch));
  let pending!: Promise<unknown>;
  act(() => { pending = hook.result.current.inspectRootRescan("first"); });
  await act(async () => { await hook.result.current.inspectRootRelocation("second", "W:/media"); });
  dispatch.mockClear();
  await act(async () => { resolve({ newCandidates: [] }); await pending; });
  expect(dispatch).not.toHaveBeenCalled();
  act(() => { pending = hook.result.current.inspectRootRescan("first"); hook.result.current.closeRecovery(); });
  dispatch.mockClear();
  await act(async () => { resolve({ newCandidates: [] }); await pending; });
  expect(dispatch).not.toHaveBeenCalled();
});
