import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpeechAudio } from "./speechTypes";
import { useLocalSpeech, type LocalSpeechController } from "./useLocalSpeech";

const speechMocks = vi.hoisted(() => ({
  listSpeechVoices: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));

vi.mock("./speechDesktop", () => speechMocks);

let latestController: LocalSpeechController | null = null;

function Harness({ onPause }: { onPause: () => void }) {
  const controller = useLocalSpeech({ language: "en-US", onBeforeSpeak: onPause });
  useEffect(() => {
    latestController = controller;
  }, [controller]);
  return (
    <>
      <button type="button" onClick={() => void controller.speak("first", "en-US", "first")}>first</button>
      <button type="button" onClick={() => void controller.speak("second", "en-US", "second")}>second</button>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("local speech playback controller", () => {
  beforeEach(() => {
    latestController = null;
    window.localStorage.clear();
    speechMocks.listSpeechVoices.mockReset().mockResolvedValue([
      { id: "voice-en", displayName: "English", language: "en-US" },
    ]);
    speechMocks.synthesizeSpeech.mockReset();
    vi.stubGlobal("Audio", class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
    });
    URL.createObjectURL = vi.fn(() => "blob:speech");
    URL.revokeObjectURL = vi.fn();
  });

  it("pauses video and discards an older synthesis when clicks overlap", async () => {
    const first = deferred<SpeechAudio>();
    const second = deferred<SpeechAudio>();
    speechMocks.synthesizeSpeech
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onPause = vi.fn();
    render(<Harness onPause={onPause} />);
    await waitFor(() => expect(latestController?.loading).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "first" }));
    fireEvent.click(screen.getByRole("button", { name: "second" }));
    expect(onPause).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve({ bytes: [1], mimeType: "audio/wav", voiceId: "voice-en", language: "en-US" });
      await first.promise;
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve({ bytes: [2], mimeType: "audio/wav", voiceId: "voice-en", language: "en-US" });
      await second.promise;
    });
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    expect(latestController?.state.kind).toBe("playing");
  });

  it("stops memory audio and does not request video resume", async () => {
    speechMocks.synthesizeSpeech.mockResolvedValue({
      bytes: [1, 2], mimeType: "audio/wav", voiceId: "voice-en", language: "en-US",
    });
    const onPause = vi.fn();
    render(<Harness onPause={onPause} />);
    await waitFor(() => expect(latestController?.loading).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "first" }));
    await waitFor(() => expect(latestController?.state.kind).toBe("playing"));
    act(() => latestController?.stop());
    expect(latestController?.state.kind).toBe("idle");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:speech");
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});
