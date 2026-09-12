import { storageSettingsFixture, storageMigrationFixture } from "../src/test-fixtures/storage";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

for (const failure of ["transport", "contract"] as const) {
test(`initial storage ${failure} failure can retry without closing settings`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ failure }) => {
    const state = window as unknown as { storageReads: number; __TAURI_INTERNALS__: unknown };
    state.storageReads = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
      if (command === "get_network_settings") return { mode: "system", proxyUrl: null, noProxy: null };
      if (command === "get_current_storage_migration") return null;
      if (command === "get_storage_settings") {
        if (++state.storageReads === 1) {
          if (failure === "contract") return { revision: -1 };
          throw new Error("存储配置暂时不可读");
        }
        return { revision: 1, appDataRoot: "W:/data", appDataRootLockedByEnvironment: false,
          remoteMediaRoot: "W:/data/remote-media", remoteMediaUsesDefault: true,
          mediaCacheRoot: "W:/data/media-cache", mediaCacheUsesDefault: true,
          defaultSubtitleExportDirectory: null, defaultVideoReportExportDirectory: null,
          appDataUsedBytes: 0, appDataFreeSpaceBytes: 100000, remoteMediaUsedBytes: 0, mediaCacheUsedBytes: 0,
          appDataAvailable: true, remoteMediaAvailable: true, mediaCacheAvailable: true, pendingAppDataRoot: null };
      }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, { failure });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/runtime.html?environment");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("tab", { name: "存储", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(failure === "contract" ? "存储设置格式不完整" : "存储配置暂时不可读");
  await expect(dialog.getByText("正在读取存储位置…")).toHaveCount(0);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "storage-read-recovery-960.png"), fullPage: true });
  await dialog.getByRole("button", { name: "重新读取存储设置" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("heading", { name: "存储位置", exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { storageReads: number }).storageReads)).toBe(2);
  expect(errors).toEqual([]);
});

}


test("uncertain storage save reads back without repeating the write", async ({ page }) => {
  await page.addInitScript(({ settings }) => {
    const state = window as unknown as { storageWrites: number; __TAURI_INTERNALS__: unknown };
    state.storageWrites = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
      if (command === "get_current_storage_migration") return null;
      if (command === "get_storage_settings") return state.storageWrites ? { ...settings, revision: 2, defaultSubtitleExportDirectory: "W:/exports" } : settings;
      if (command === "plugin:dialog|open") return "W:/exports";
      if (command === "save_storage_settings") { state.storageWrites++; return settings; }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, { settings: storageSettingsFixture });
  await page.goto("/e2e/runtime.html?environment");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("tab", { name: "存储", exact: true }).click();
  await dialog.getByRole("button", { name: "选择默认位置", exact: true }).first().click();
  await dialog.getByRole("button", { name: "应用设置", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存结果尚未确认");
  await expect(dialog.getByText("W:/exports", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "重新读取存储设置" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "应用设置", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { storageWrites: number }).storageWrites)).toBe(1);
});


test("post-migration refresh failure remains visible and can be reread", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ settings, migration }) => {
    const state = window as unknown as { storageReads: number; __TAURI_INTERNALS__: unknown };
    state.storageReads = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
      if (command === "get_current_storage_migration") return migration;
      if (command === "get_storage_settings") {
        if (++state.storageReads === 2) throw new Error("读取暂时失败");
        return settings;
      }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, { settings: storageSettingsFixture, migration: storageMigrationFixture });
  await page.goto("/e2e/runtime.html?environment");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("tab", { name: "存储", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("存储设置刷新失败");
  await dialog.getByRole("button", { name: "重新读取存储设置" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { storageReads: number }).storageReads)).toBe(3);
  expect(errors).toEqual([]);
});


test("slow migration polling is serial and stops at cancellation", async ({ page }) => {
  await page.addInitScript(({ settings, migration }) => {
    const state = window as unknown as { migrationReads: number; releaseMigrationRead: () => void; __TAURI_INTERNALS__: unknown };
    state.migrationReads = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
      if (command === "get_current_storage_migration") return { ...migration, status: "running" };
      if (command === "get_storage_settings") return settings;
      if (command === "get_storage_migration") {
        state.migrationReads++;
        return new Promise(resolve => { state.releaseMigrationRead = () => resolve({ ...migration, status: "cancelled" }); });
      }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, { settings: storageSettingsFixture, migration: storageMigrationFixture });
  await page.goto("/e2e/runtime.html?environment");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("tab", { name: "存储", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { migrationReads: number }).migrationReads)).toBe(1);
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => (window as unknown as { migrationReads: number }).migrationReads)).toBe(1);
  await page.evaluate(() => (window as unknown as { releaseMigrationRead: () => void }).releaseMigrationRead());
  await expect(dialog.getByRole("button", { name: "查看迁移", exact: true })).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { migrationReads: number }).migrationReads)).toBe(1);
});


test("cancel acknowledgement stays pending until migration worker stops", async ({ page }) => {
  await page.addInitScript(({ settings, migration }) => {
    const state = window as unknown as { cancelCalls: number; finishMigration?: () => void; __TAURI_INTERNALS__: unknown };
    state.cancelCalls = 0;
    const running = { ...migration, status: "running" };
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
      if (command === "get_current_storage_migration") return running;
      if (command === "get_storage_settings") return settings;
      if (command === "cancel_storage_migration") { state.cancelCalls++; return running; }
      if (command === "get_storage_migration") return state.cancelCalls ? new Promise(resolve => { state.finishMigration = () => resolve({ ...migration, status: "cancelled" }); }) : running;
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, { settings: storageSettingsFixture, migration: storageMigrationFixture });
  await page.goto("/e2e/runtime.html?environment");
  await page.getByRole("tab", { name: "存储", exact: true }).click();
  await page.getByRole("button", { name: "查看迁移", exact: true }).click();
  await page.getByRole("button", { name: "取消迁移", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在停止迁移…", exact: true })).toBeDisabled();
  await page.waitForFunction(() => typeof (window as unknown as { finishMigration?: () => void }).finishMigration === "function");
  expect(await page.evaluate(() => (window as unknown as { cancelCalls: number }).cancelCalls)).toBe(1);
  await page.evaluate(() => (window as unknown as { finishMigration: () => void }).finishMigration());
  await expect(page.getByRole("button", { name: "正在停止迁移…", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "继续迁移", exact: true })).toBeEnabled();
});
