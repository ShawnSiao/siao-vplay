import { expect, test } from "@playwright/test";
import { createSummaryFixtures } from "../src/test-fixtures/summary";
import { summaryDispatchFixture } from "../src/test-fixtures/summaryDispatch";

test("completed summary read retries without dispatching again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { task, summary } = createSummaryFixtures();
  await page.addInitScript(({ task, summary, preview }) => {
    const state = window as unknown as { summarySends: unknown[]; __TAURI_INTERNALS__: unknown };
    state.summarySends = [];
    let reads = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_summary_tasks": case "list_video_summaries": return [];
        case "list_analysis_prompt_templates": return [];
        case "preview_ai_execution": return { executionKind: "codex", serviceConfigId: null, providerId: null, displayName: "本机 Codex", modelId: null, subtitles: true, currentQuestion: true, framesRequested: false, framesEffective: false, serviceRevision: null };
        case "prepare_summary_task": return { ...task, status: "prepared" };
        case "preview_summary_dispatch": return preview;
        case "start_summary_task": case "resume_summary_task": state.summarySends.push(args); return { ...task, status: "completed", outputSummaryId: summary.id };
        case "get_video_summary": if (++reads === 1) throw new Error("读取暂时失败"); return summary;
        case "get_summary_task": return task;
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, summary, preview: summaryDispatchFixture() });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?summary=confirm");
  await page.getByRole("button", { name: "准备并查看发送清单" }).click();
  await page.getByRole("button", { name: "确认发送并开始" }).click();
  await expect(page.getByRole("alert")).toContainText("读取暂时失败");
  await page.getByRole("button", { name: "重新读取总结" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: summary.result.title })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { summarySends: unknown[] }).summarySends)).toHaveLength(1);
  expect(errors).toEqual([]);
});
