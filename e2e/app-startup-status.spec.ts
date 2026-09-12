import { expect, test } from "@playwright/test";
test("invalid startup status has a separate visible error and never opens its media path", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { opened: number; __TAURI_INTERNALS__: unknown };
    state.opened = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_app_status") return { startupMediaPath: "F:/must-not-open.mp4" };
      if (command === "open_local_project") state.opened++;
      throw new Error("测试环境未提供此服务");
    } };
  });
  await page.goto("/");
  await expect(page.getByText("应用启动信息读取失败，请重新启动应用。")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { opened: number }).opened)).toBe(0);
});

test("startup reports interrupted transcription without restarting it", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { starts: number; __TAURI_INTERNALS__: unknown };
    state.starts = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_app_status") return { appName: "SiaoVPlay", version: "0.4.1",
        platform: "windows-desktop", dataDirectory: "W:/isolated", startupMediaPath: null,
        interruptedTranscriptionCount: 2 };
      if (command === "start_transcription" || command === "resume_transcription_job") state.starts++;
      throw new Error("测试环境未提供此服务");
    } };
  });
  await page.goto("/");
  await expect(page.getByText("上次的原文字幕生成已中断", { exact: true })).toBeVisible();
  await expect(page.getByText("2 项任务尚未完成。打开对应视频的字幕工具，可检查任务并重新开始。")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { starts: number }).starts)).toBe(0);
});
