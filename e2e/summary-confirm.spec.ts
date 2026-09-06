import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createSummaryFixtures } from "../src/test-fixtures/summary";
import { summaryDispatchFixture } from "../src/test-fixtures/summaryDispatch";

test("summary sends only after the actual material snapshot is confirmed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { task } = createSummaryFixtures();
  await page.addInitScript(({ task, preview }) => {
    const state = window as unknown as { summarySends: unknown[]; __TAURI_INTERNALS__: unknown };
    state.summarySends = [];
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true };
        case "get_ai_service_settings": return { services: [], defaultServiceId: null };
        case "list_summary_tasks": case "list_video_summaries": return [];
        case "list_analysis_prompt_templates": return [];
        case "preview_ai_execution": return { executionKind: "codex", subtitles: true, framesEffective: false };
        case "prepare_summary_task": return { ...task, status: "prepared" };
        case "preview_summary_dispatch": return preview;
        case "start_summary_task": case "resume_summary_task": state.summarySends.push(args); return task;
        case "get_summary_task": return task;
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, preview: summaryDispatchFixture() });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?summary=confirm");
  await page.getByRole("button", { name: "准备并查看发送清单" }).click();
  const confirmation = page.getByRole("region", { name: "总结材料确认" });
  await expect(confirmation.getByText("OpenAI（经本机 Codex）", { exact: true })).toBeVisible();
  await expect(confirmation.getByText("原文 · en · 第 3 版")).toBeVisible();
  await expect(confirmation.getByText("本次不发送图片。")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { summarySends: unknown[] }).summarySends)).toEqual([]);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "summary-confirm-960.png"), fullPage: true });
  await confirmation.getByRole("button", { name: "返回任务" }).click();
  expect(await page.evaluate(() => (window as unknown as { summarySends: unknown[] }).summarySends)).toEqual([]);
  await page.getByRole("button", { name: "开始任务" }).click();
  const send = page.getByRole("button", { name: "确认发送并开始" });
  await send.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("已完成 3 / 7 段")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { summarySends: unknown[] }).summarySends)).toEqual([
    { input: { taskId: "summary-task-1", confirmationSha256: "a".repeat(64) } },
  ]);
  expect(errors).toEqual([]);
});
