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

export async function verifyTranscriptionChoicesResume(mocks: Record<"getTranscriptionRuntimeStatus" | "setLocalResourceProfile", Mock>, ready: LocalResourceStatus, failFirst = false) {
  mocks.getTranscriptionRuntimeStatus.mockResolvedValue({ available: false, preferredBackend: "cpu", runtimes: [], models: [] });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /继续播放/ }));
  await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
  const video = document.querySelector("video")!;
  video.currentTime = 12;
  fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));
  fireEvent.click(await screen.findByRole("tab", { name: "从视频生成" }));
  fireEvent.change(await screen.findByRole("combobox", { name: /视频原声语言/ }), { target: { value: "ja" } });
  fireEvent.click(screen.getAllByRole("radio").find(input => (input as HTMLInputElement).value === "standard")!);
  if (failFirst) {
    mocks.setLocalResourceProfile.mockRejectedValueOnce(new Error("configuration unavailable"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "准备本地字幕识别" })); });
    expect(screen.getByRole("combobox", { name: /视频原声语言/ })).toHaveValue("ja");
    expect(screen.getAllByRole("radio").find(input => (input as HTMLInputElement).value === "standard")!).toBeChecked();
    expect(screen.getByRole("button", { name: "准备本地字幕识别" })).toBeEnabled();
    expect(mocks.setLocalResourceProfile).toHaveBeenCalledTimes(1);
  }
  mocks.setLocalResourceProfile.mockResolvedValue(ready);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "准备本地字幕识别" })); });
  await waitFor(() => expect(screen.getByRole("tab", { name: "从视频生成" })).toHaveAttribute("aria-selected", "true"));
  await waitFor(() => expect(screen.getByRole("combobox", { name: /视频原声语言/ })).toHaveValue("ja"));
  expect(screen.getAllByRole("radio").find(input => (input as HTMLInputElement).value === "standard")!).toBeChecked();
  expect(mocks.setLocalResourceProfile).toHaveBeenCalledTimes(failFirst ? 2 : 1);
  expect(document.querySelector("video")).toBe(video);
  expect(video.currentTime).toBe(12);
}

export async function verifyStaleTranscriptionPreparation(mocks: Record<"getTranscriptionRuntimeStatus" | "setLocalResourceProfile", Mock>, ready?: LocalResourceStatus, leavePlayer = true) {
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
  if (leavePlayer) fireEvent.click((await screen.findAllByRole("button", { name: "返回媒体库" }))[0]);
  await act(async () => { finish(); await pending; });
  expect(screen.queryByRole("heading", { name: "准备原文字幕" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
}
