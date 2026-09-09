import { expect, test } from "@playwright/test";
import { createBurnJobFixture } from "../src/test-fixtures/burn";
test("burn sends normalized style and selected versions only after confirmation", async ({ page }) => {
  const job = { ...createBurnJobFixture(), projectId: "e2e-project", translationVersionId: "burn-translation" };
  await page.addInitScript(job => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; starts: unknown[] };
    state.starts = [];
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: { input: unknown }) => {
      if (command === "list_subtitle_burn_jobs") return [];
      if (command === "get_storage_settings") return { revision: 1, appDataRoot: "fixture", appDataRootLockedByEnvironment: false,
        remoteMediaRoot: "fixture", remoteMediaUsesDefault: true, mediaCacheRoot: "fixture", mediaCacheUsesDefault: true,
        defaultSubtitleExportDirectory: null, defaultVideoReportExportDirectory: null, appDataUsedBytes: 0, appDataFreeSpaceBytes: null,
        remoteMediaUsedBytes: 0, mediaCacheUsedBytes: 0, appDataAvailable: true, remoteMediaAvailable: true, mediaCacheAvailable: true };
      if (command === "plugin:dialog|open") return "fixture-output";
      if (command === "start_subtitle_burn") { state.starts.push(args.input); return job; }
      if (command === "get_subtitle_burn_job") return job;
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, job);
  await page.goto("/e2e/player.html?burn");
  await page.getByRole("button", { name: /烧录视频/ }).click();
  const start = page.getByRole("button", { name: "选择位置并开始烧录", exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox", { name: /确认使用以上字幕版本/ }).check();
  await start.click();
  await expect(page.getByRole("button", { name: "取消烧录", exact: true })).toBeVisible();
  const inputs = await page.evaluate(() => (window as unknown as { starts: { style: { positionY: number; textSize: string } }[] }).starts);
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toMatchObject({ projectId: job.projectId, mode: "translation", sourceVersionId: null,
    translationVersionId: "burn-translation", destinationDirectory: "fixture-output", confirmVersionSelection: true });
  expect(inputs[0].style.positionY).toBeGreaterThanOrEqual(0);
  expect(inputs[0].style.positionY).toBeLessThanOrEqual(1);
  expect(["small", "medium", "large"]).toContain(inputs[0].style.textSize);
  await expect(page.getByText(/Unexpected fixture IPC/)).toHaveCount(0);
});
