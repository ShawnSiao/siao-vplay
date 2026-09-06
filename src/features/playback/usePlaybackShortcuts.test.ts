import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePlaybackShortcuts } from "./usePlaybackShortcuts";

describe("playback shortcut ownership", () => {
  it("does not handle a key consumed by a dialog", () => {
    const onBack = vi.fn();
    const onTogglePlayback = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePlaybackShortcuts({
      contextMenuOpen: false, drawerOpen: false, playbackRate: 1,
      positionMs: 0, seekStepMs: 5_000, videoRef: { current: null },
      setPlaybackRate: vi.fn(), onBack, onCloseContextMenu: vi.fn(),
      onCloseDrawer: vi.fn(), onSeek: vi.fn(), onToggleFullscreen: vi.fn(),
      onToggleMuted: vi.fn(), onTogglePlayback,
    }));
    for (const key of ["Escape", " "]) {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      event.preventDefault();
      window.dispatchEvent(event);
    }
    expect(onBack).not.toHaveBeenCalled();
    expect(onTogglePlayback).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
