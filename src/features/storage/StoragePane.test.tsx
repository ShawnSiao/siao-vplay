import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StorageSettings } from "../../types";
import { StoragePane } from "./StoragePane";
import type { StorageSettingsController } from "./useStorageSettings";

const settings: StorageSettings = {
  revision: 3,
  appDataRoot: "C:\\SiaoVPlay\\Data",
  appDataRootLockedByEnvironment: false,
  remoteMediaRoot: "W:\\SiaoVPlay\\Media",
  remoteMediaUsesDefault: false,
  mediaCacheRoot: "W:\\SiaoVPlay\\Cache",
  mediaCacheUsesDefault: false,
  defaultSubtitleExportDirectory: null,
  defaultVideoReportExportDirectory: "D:\\SiaoVPlay\\Exports",
  appDataUsedBytes: 1024,
  appDataFreeSpaceBytes: 1024 ** 3,
  remoteMediaUsedBytes: 2048,
  mediaCacheUsedBytes: 4096,
  appDataAvailable: true,
  remoteMediaAvailable: true,
  mediaCacheAvailable: true,
  pendingAppDataRoot: null,
};

function controller(
  patch: Partial<StorageSettingsController> = {},
): StorageSettingsController {
  return {
    settings,
    subtitleDirectory: null,
    reportDirectory: settings.defaultVideoReportExportDirectory,
    migration: null,
    operation: null,
    error: null,
    setSubtitleDirectory: vi.fn(),
    setReportDirectory: vi.fn(),
    chooseDefault: vi.fn(async () => undefined),
    saveDefaults: vi.fn(async () => undefined),
    prepare: vi.fn(async () => null),
    start: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    openLocation: vi.fn(async () => undefined),
    chooseMigrationDirectory: vi.fn(async () => "W:\\SiaoVPlay\\NewData"),
    restart: vi.fn(async () => undefined),
    clearError: vi.fn(),
    reload: vi.fn(async () => undefined),
    ...patch,
  } as StorageSettingsController;
}

describe("StoragePane", () => {
  it("shows all five storage responsibilities and keeps export choice explicit", () => {
    const value = controller();
    render(<StoragePane controller={value} />);
    expect(screen.getByText("应用数据与数据库")).toBeVisible();
    expect(screen.getByText("URL 导入视频")).toBeVisible();
    expect(screen.getByText("播放缓存")).toBeVisible();
    expect(screen.getByText("字幕")).toBeVisible();
    expect(screen.getByText("视频与分析报告")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "选择默认位置" }));
    expect(value.chooseDefault).toHaveBeenCalledWith("subtitle");
  });

  it("requires an inline confirmation before clearing playback cache", () => {
    const value = controller();
    render(<StoragePane controller={value} />);
    fireEvent.click(screen.getByRole("button", { name: "清理缓存" }));
    expect(screen.getByText(/原视频、字幕和项目记录不受影响/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "确认清理" }));
    expect(value.clearCache).toHaveBeenCalledTimes(1);
  });

  it("prepares migration only after an empty target directory is selected", async () => {
    const value = controller();
    render(<StoragePane controller={value} />);
    fireEvent.click(screen.getByRole("button", { name: "迁移" }));
    fireEvent.click(screen.getByRole("button", { name: "选择文件夹" }));
    await waitFor(() => expect(screen.getByLabelText("新的存储位置")).toHaveValue("W:\\SiaoVPlay\\NewData"));
    fireEvent.click(screen.getByRole("button", { name: "检查迁移条件" }));
    await waitFor(() => expect(value.prepare).toHaveBeenCalledWith(
      "app_data",
      "W:\\SiaoVPlay\\NewData",
      "copy",
    ));
  });

  it("surfaces an interrupted migration and offers resume", () => {
    const value = controller({
      migration: {
        id: "migration-1",
        area: "remote_media",
        mode: "copy",
        status: "interrupted",
        sourceRoot: "C:\\old",
        destinationRoot: "W:\\new",
        bytesToCopy: 100,
        copiedBytes: 40,
        fileCount: 10,
        verifiedFileCount: 4,
        freeSpaceBytes: 1000,
        previousRootRetained: true,
        restartRequired: false,
        errorCode: null,
        errorMessage: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    render(<StoragePane controller={value} />);
    fireEvent.click(screen.getByRole("button", { name: "查看迁移" }));
    expect(screen.getByRole("button", { name: "继续迁移" })).toBeVisible();
  });
});


it("does not open the saved location under a different draft directory", () => {
  const value = controller({ reportDirectory: "W:/unsaved-report" });
  render(<StoragePane controller={value} />);
  const button = screen.getByTitle("应用设置后可打开新位置");
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(value.openLocation).not.toHaveBeenCalled();
});


it("shows the initial read failure and an explicit retry instead of indefinite loading", () => {
  const value = controller({ settings: null, error: "存储配置暂时不可读", operation: null });
  render(<StoragePane controller={value} />);
  expect(screen.getByRole("alert")).toHaveTextContent("存储配置暂时不可读");
  expect(screen.queryByText("正在读取存储位置…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新读取存储设置" }));
  expect(value.reload).toHaveBeenCalledTimes(1);
});
