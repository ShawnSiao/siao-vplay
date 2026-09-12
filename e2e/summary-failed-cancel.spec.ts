import { expect, test } from "@playwright/test";
import { createSummaryFixtures } from "../src/test-fixtures/summary";

test("failed summary can be cancelled with the keyboard without sending again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { task } = createSummaryFixtures();
  task.status = "failed";
  task.errorMessage = "连接失败，已完成片段保留。";
  await page.addInitScript(task => {
    const host = window as unknown as { __TAURI_INTERNALS__: unknown; summaryCalls: string[] };
    host.summaryCalls = [];
    host.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      host.summaryCalls.push(command);
      switch (command) {
        case "get_codex_runtime_status": return { available: false, authenticated: false, supported: false, version: null, minimumVersion: "0.100.0", authMode: null, errorCode: "codex_runtime_unavailable", errorMessage: "未找到 Codex" };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_summary_tasks": return [task];
        case "list_video_summaries": return [];
        case "get_summary_task": return task;
        case "cancel_summary_task": task.status = "cancelled"; return task;
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, task);
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?summary=confirm");
  await expect(page.getByText("已完成 3 / 7 段")).toBeVisible();
  await page.getByRole("button", { name: "取消总结" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "取消总结" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "继续总结" })).toHaveCount(0);
  await expect(page.getByText("已完成 3 / 7 段")).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { summaryCalls: string[] }).summaryCalls);
  expect(calls.filter(command => command === "cancel_summary_task")).toHaveLength(1);
  expect(calls.filter(command => ["prepare_summary_task", "start_summary_task", "resume_summary_task"].includes(command))).toEqual([]);
  expect(errors).toEqual([]);
});
