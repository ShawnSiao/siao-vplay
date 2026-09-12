import { beforeEach, expect, it, vi } from "vitest";
import { getStorageSettings, saveStorageSettings } from "./gateway";
import { chooseConfiguredStorageDirectory } from "../../lib/storageDirectoryPicker";
import { storageSettingsFixture as settings } from "../../test-fixtures/storage";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
const input = { expectedRevision: 1, remoteMediaRoot: null, mediaCacheRoot: null, defaultSubtitleExportDirectory: null, defaultVideoReportExportDirectory: null };
beforeEach(() => { vi.resetAllMocks(); });
it.each([null, {}, { ...settings, revision: -1 }, { ...settings, appDataUsedBytes: 1.5 }, { ...settings, appDataFreeSpaceBytes: Number.MAX_SAFE_INTEGER + 1 }, { ...settings, appDataRoot: " " }, { ...settings, defaultSubtitleExportDirectory: "" }])("rejects malformed storage settings", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getStorageSettings()).rejects.toThrow();
});
it("does not pass an invalid configured path to the directory dialog", async () => {
  mocks.invoke.mockResolvedValue({ defaultSubtitleExportDirectory: 123 });
  await expect(chooseConfiguredStorageDirectory("subtitle", "选择目录")).rejects.toThrow();
  expect(mocks.open).not.toHaveBeenCalled();
});
it.each([-1, 1.5, Number.MAX_SAFE_INTEGER])("rejects an unsafe save revision before writing", async expectedRevision => {
  await expect(saveStorageSettings({ ...input, expectedRevision })).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("requires a revision advanced by this save and does not repeat a write", async () => {
  mocks.invoke.mockResolvedValue(settings);
  await expect(saveStorageSettings(input)).rejects.toThrow("保存结果尚未确认");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("captures a save input before asynchronous validation", async () => {
  mocks.invoke.mockResolvedValue({ ...settings, revision: 2 });
  const draft = { ...input };
  const pending = saveStorageSettings(draft);
  draft.expectedRevision = 99;
  await pending;
  expect(mocks.invoke).toHaveBeenCalledWith("save_storage_settings", { input });
});
it("accepts a complete view and forwards its export preference", async () => {
  mocks.invoke.mockResolvedValue(settings);
  mocks.open.mockResolvedValue("W:/exports");
  await expect(getStorageSettings()).resolves.toEqual(settings);
  await expect(chooseConfiguredStorageDirectory("report", "选择目录")).resolves.toBe("W:/exports");
});

it.each([{ remoteMediaUsesDefault: false }, { mediaCacheUsesDefault: false }, { defaultSubtitleExportDirectory: "W:/unexpected" }])("rejects save acknowledgements with different default choices", async patch => {
  mocks.invoke.mockResolvedValue({ ...settings, revision: 2, ...patch });
  await expect(saveStorageSettings(input)).rejects.toThrow("保存结果尚未确认");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("accepts backend-canonicalized directories while binding the save revision", async () => {
  const response = { ...settings, revision: 2, defaultSubtitleExportDirectory: "W:/canonical/exports" };
  mocks.invoke.mockResolvedValue(response);
  await expect(saveStorageSettings({ ...input, defaultSubtitleExportDirectory: " W:/alias/exports " })).resolves.toEqual(response);
});
