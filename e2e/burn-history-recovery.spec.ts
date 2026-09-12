import { expect, test } from "@playwright/test";
import { createBurnJobFixture } from "../src/test-fixtures/burn";

test("burn history retry preserves export choices and exposes interrupted-job recovery", async ({ page }) => {
  const job = { ...createBurnJobFixture(), projectId: "e2e-project", translationVersionId: "burn-translation", status: "interrupted", stage: "interrupted" };
  await page.addInitScript(job => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; reads: number; writes: number };
    state.reads = 0; state.writes = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "list_subtitle_burn_jobs") {
        if (++state.reads === 1) throw new Error("历史暂不可用");
        return [job];
      }
      state.writes++;
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, job);
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?burn");
  await expect(page.getByText("历史暂不可用", { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "选择位置并导出", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /烧录视频/ }).click();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "选择位置并开始烧录", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /字幕文件/ }).click();
  await page.getByRole("combobox", { name: "字幕文件格式" }).selectOption("vtt");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "重新读取烧录记录" }).click();
  await expect(page.getByRole("button", { name: /最近一次烧录/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "字幕文件格式" })).toHaveValue("vtt");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: /最近一次烧录/ }).click();
  await expect(page.getByRole("heading", { name: "上次任务已中断" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新开始", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(0);
});
