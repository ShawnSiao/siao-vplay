import { expect, test } from "@playwright/test";

test("pending directory selection locks delivery and closing prevents a late export", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; picks: number; writes: number; finish: (path: string | null) => void };
    state.picks = 0; state.writes = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "list_subtitle_burn_jobs") return [];
      if (command === "get_storage_settings") return { revision: 1, appDataRoot: "fixture", appDataRootLockedByEnvironment: false,
        remoteMediaRoot: "fixture", remoteMediaUsesDefault: true, mediaCacheRoot: "fixture", mediaCacheUsesDefault: true,
        defaultSubtitleExportDirectory: null, defaultVideoReportExportDirectory: null, appDataUsedBytes: 0, appDataFreeSpaceBytes: null,
        remoteMediaUsedBytes: 0, mediaCacheUsedBytes: 0, appDataAvailable: true, remoteMediaAvailable: true, mediaCacheAvailable: true, pendingAppDataRoot: null };
      if (command === "plugin:dialog|open") {
        state.picks++;
        return new Promise(resolve => { state.finish = resolve; });
      }
      if (command === "export_subtitles" || command === "start_subtitle_burn") { state.writes++; throw new Error("unexpected write"); }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  });
  await page.goto("/e2e/player.html?burn");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "选择位置并导出", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在选择保存位置…" })).toBeDisabled();
  await expect(page.locator(".delivery-dialog")).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest(".delivery-dialog") !== null)).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as unknown as { picks: number }).picks)).toBe(1);
  await page.evaluate(() => (window as unknown as { finish: (path: null) => void }).finish(null));
  await expect(page.getByRole("button", { name: "选择位置并导出", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "选择位置并导出", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { picks: number }).picks)).toBe(2);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => (window as unknown as { finish: (path: string) => void }).finish("fixture-output"));
  expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(0);
});
