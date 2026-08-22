import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fullscreenControlsHideDelayMs,
  useFullscreenControlVisibility,
} from "./useFullscreenControlVisibility";

describe("fullscreen control visibility", () => {
  afterEach(() => vi.useRealTimers());

  it("hides after inactivity, reveals on interaction, and stays visible in windowed mode", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ fullscreen }) => useFullscreenControlVisibility(fullscreen),
      { initialProps: { fullscreen: false } },
    );
    rerender({ fullscreen: true });
    expect(result.current.controlsVisible).toBe(true);

    act(() => vi.advanceTimersByTime(fullscreenControlsHideDelayMs));
    expect(result.current.controlsVisible).toBe(false);
    act(() => result.current.revealControls());
    expect(result.current.controlsVisible).toBe(true);

    rerender({ fullscreen: false });
    act(() => vi.advanceTimersByTime(fullscreenControlsHideDelayMs));
    expect(result.current.controlsVisible).toBe(true);
  });
});
