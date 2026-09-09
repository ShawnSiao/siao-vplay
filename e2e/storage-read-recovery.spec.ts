import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("initial storage read failure can retry without closing settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as { storageReads: number; __TAURI_INTERNALS__: unknown };
    state.storageReads = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
      if (command === "get_network_settings") return { mode: "system", proxyUrl: null, noProxy: null };
      if (command === "get_current_storage_migration") return null;
      if (command === "get_storage_settings") {
        if (++state.storageReads === 1) throw new Error("存储配置暂时不可读");
        return { revision: 1, appDataRoot: "W:/data", appDataRootLockedByEnvironment: false,
          remoteMediaRoot: "W:/data/remote-media", remoteMediaUsesDefault: true,
          mediaCacheRoot: "W:/data/media-cache", mediaCacheUsesDefault: true,
          defaultSubtitleExportDirectory: null, defaultVideoReportExportDirectory: null,
          appDataUsedBytes: 0, appDataFreeSpaceBytes: 100000, remoteMediaUsedBytes: 0, mediaCacheUsedBytes: 0,
          appDataAvailable: true, remoteMediaAvailable: true, mediaCacheAvailable: true, pendingAppDataRoot: null };
      }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/runtime.html?environment");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("tab", { name: "存储", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("存储配置暂时不可读");
  await expect(dialog.getByText("正在读取存储位置…")).toHaveCount(0);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "storage-read-recovery-960.png"), fullPage: true });
  await dialog.getByRole("button", { name: "重新读取存储设置" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("heading", { name: "存储位置", exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { storageReads: number }).storageReads)).toBe(2);
  expect(errors).toEqual([]);
});
