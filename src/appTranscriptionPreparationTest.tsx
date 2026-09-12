import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, type Mock } from "vitest";
import App from "./App";
import type { LocalResourceStatus } from "./types";

export async function verifyLocalImportShortcut(chooseLocalVideo: Mock) {
  render(<App />);
  await screen.findAllByText("雨站台");
  fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  await waitFor(() => expect(chooseLocalVideo).toHaveBeenCalled());
}

export async function verifyStaleTranscriptionPreparation(mocks: Record<"getTranscriptionRuntimeStatus" | "setLocalResourceProfile", Mock>, ready?: LocalResourceStatus) {
  mocks.getTranscriptionRuntimeStatus.mockResolvedValue({ available: false, preferredBackend: "cpu", runtimes: [], models: [] });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  mocks.setLocalResourceProfile.mockImplementation(async () => {
    await pending;
    if (ready) return ready;
    throw new Error("late profile failure");
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /继续播放/ }));
  fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));
  fireEvent.click(await screen.findByRole("tab", { name: "从视频生成" }));
  fireEvent.click(await screen.findByRole("button", { name: "准备本地字幕识别" }));
  await waitFor(() => expect(mocks.setLocalResourceProfile).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click((await screen.findAllByRole("button", { name: "返回媒体库" }))[0]);
  await act(async () => { finish(); await pending; });
  expect(screen.queryByRole("heading", { name: "准备原文字幕" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
}

