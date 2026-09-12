import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { MediaPreparation, Project } from "../../types";
import { usePlaybackController, type PlaybackValues } from "./usePlaybackController";
vi.mock("../../lib/desktop", () => ({ playbackUrl: (path: string) => path }));

it("saves the detached video's final values once and waits for its original persistence callback", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const persist = vi.fn<(values: PlaybackValues) => Promise<void>>(() => pending);
  function Player() {
    const controller = usePlaybackController({
      project: { playbackState: { positionMs: 0, durationMs: 100000, volume: 1, playbackRate: 1, subtitleMode: "bilingual" } } as Project,
      preparation: { playbackPath: "/fixture.mp4", playbackSourceKind: "original", inspection: { probe: { durationMs: 100000, videoStreams: [], audioStreams: [] } } } as unknown as MediaPreparation,
      currentSubtitle: null, currentTranslation: null, drawerTab: null, contextMenu: null, seekStepMs: 5000,
      onBack: vi.fn(), onCloseDrawer: vi.fn(), onCloseContextMenu: vi.fn(), onNeedProxy: vi.fn(),
      onPersist: persist, onError: vi.fn(), onFatalError: vi.fn(),
    });
    return <video ref={controller.videoRef} data-testid="video" />;
  }
  const view = render(<Player />);
  const video = screen.getByTestId("video") as HTMLVideoElement;
  video.currentTime = 12.345;
  video.volume = 0.4;
  video.playbackRate = 1.5;
  view.unmount();
  await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  expect(persist).toHaveBeenCalledWith({ positionMs: 12345, durationMs: 100000, volume: 0.4, playbackRate: 1.5, subtitleMode: "bilingual" });
  await act(async () => { finish(); await pending; });
  expect(persist).toHaveBeenCalledTimes(1);
});
