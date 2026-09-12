import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";
import App from "./App";
import { openEnvironmentSettings } from "./features/environment-settings/events";
import * as storage from "./features/storage/gateway";
import { storageSettingsFixture } from "./test-fixtures/storage";

export async function verifyPreparationStorageSettings(prepare: Mock) {
  prepare.mockRejectedValueOnce(new Error("disk full"));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "打开最近观看的 雨站台" }));
  fireEvent.click(await screen.findByRole("button", { name: "存储设置" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "存储" })).toHaveClass("active"));
  expect(prepare).toHaveBeenCalledTimes(1);
}

export async function verifySettingsEscapeLayers() {
  const settingsRead = vi.spyOn(storage, "getStorageSettings").mockResolvedValue(storageSettingsFixture);
  const migrationRead = vi.spyOn(storage, "getCurrentStorageMigration").mockResolvedValue(null);
  try {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /继续播放/ }));
    const video = await screen.findByLabelText("视频画面，单击播放或暂停") as HTMLVideoElement;
    video.currentTime = 12.5;
    fireEvent.timeUpdate(video);
    act(() => openEnvironmentSettings("storage"));
    const settings = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.click(await within(settings).findByRole("button", { name: "迁移" }));
    const migration = await screen.findByRole("dialog", { name: "迁移应用数据与数据库" });
    fireEvent.keyDown(within(migration).getByRole("button", { name: "关闭迁移窗口" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "迁移应用数据与数据库" })).not.toBeInTheDocument();
    expect(settings).toBeInTheDocument();
    expect(video).toBeInTheDocument();
    expect(video.currentTime).toBe(12.5);
    fireEvent.keyDown(settings, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("视频画面，单击播放或暂停")).toBe(video);
    expect(video.currentTime).toBe(12.5);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("视频画面，单击播放或暂停")).not.toBeInTheDocument());
  } finally {
    settingsRead.mockRestore();
    migrationRead.mockRestore();
  }
}
