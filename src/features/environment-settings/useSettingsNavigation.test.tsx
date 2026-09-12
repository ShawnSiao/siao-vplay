import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSettingsNavigation } from "./useSettingsNavigation";
import { openEnvironmentSettings } from "./events";

it("retains the latest requested tab before any dialog mounts", () => {
  const open = vi.fn();
  const { result } = renderHook(() => useSettingsNavigation(open));
  act(() => openEnvironmentSettings("storage"));
  expect(result.current.tab).toBe("storage");
  act(() => openEnvironmentSettings("ai"));
  expect(result.current.tab).toBe("ai");
  expect(open).toHaveBeenCalledTimes(2);
});
it("uses the latest opener and clears a cancelled intent on ordinary navigation", () => {
  const open = vi.fn(); const next = vi.fn();
  const { result, rerender } = renderHook(({ opener }) => useSettingsNavigation(opener), { initialProps: { opener: open } });
  act(() => openEnvironmentSettings("storage"));
  rerender({ opener: next });
  act(() => result.current.openDefault());
  expect(result.current.tab).toBe("local");
  expect(next).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});
it("removes its listener on unmount without leaving a delayed reopen", async () => {
  const open = vi.fn();
  const { unmount } = renderHook(() => useSettingsNavigation(open));
  unmount();
  act(() => openEnvironmentSettings("storage"));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(open).not.toHaveBeenCalled();
});
