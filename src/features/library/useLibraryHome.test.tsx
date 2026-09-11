import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLibraryHome } from "./useLibraryHome";
import { libraryHome } from "./libraryControllerTestFixtures";
const mocks = vi.hoisted(() => ({ getLibraryHome: vi.fn() }));
vi.mock("./libraryGateway", () => mocks);
beforeEach(() => { vi.resetAllMocks(); });

it.each([false, true])("does not deliver home refresh after unmount (failure=%s)", async failure => {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  mocks.getLibraryHome.mockReturnValue(pending);
  const dispatch = vi.fn();
  const hook = renderHook(() => useLibraryHome(dispatch));
  const refresh = hook.result.current;
  hook.unmount();
  dispatch.mockClear();
  await act(async () => { if (failure) reject(new Error("late")); else resolve(libraryHome(1)); await pending.catch(() => undefined); });
  await act(async () => { await refresh(); });
  expect(mocks.getLibraryHome).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalled();
});
