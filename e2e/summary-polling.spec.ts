import { expect, test } from "@playwright/test";
import { createSummaryFixtures } from "../src/test-fixtures/summary";
import { summaryDispatchFixture } from "../src/test-fixtures/summaryDispatch";

test("summary polling keeps one slow read and stops after completion", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { task, summary } = createSummaryFixtures();
  await page.addInitScript(({ task, summary, preview }) => {
    const state = window as unknown as { summarySends: unknown[]; polls: number; finish: () => void; __TAURI_INTERNALS__: unknown };
    state.summarySends = [];
    state.polls = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_summary_tasks": case "list_video_summaries": return [];
        case "list_analysis_prompt_templates": return [];
        case "preview_ai_execution": return { executionKind: "codex", serviceConfigId: null, providerId: null, displayName: "本机 Codex", modelId: null, subtitles: true, currentQuestion: true, framesRequested: false, framesEffective: false, serviceRevision: null };
        case "prepare_summary_task": return { ...task, status: "prepared" };
        case "preview_summary_dispatch": return preview;
        case "start_summary_task": case "resume_summary_task": state.summarySends.push(args); return task;
        case "get_video_summary": return summary;
        case "get_summary_task": state.polls++; return new Promise(resolve => { state.finish = () => resolve({ ...task, status: "completed", outputSummaryId: summary.id }); });
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, summary, preview: summaryDispatchFixture() });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.clock.install();
  await page.goto("/e2e/player.html?summary=confirm");
  await page.getByRole("button", { name: "准备并查看发送清单" }).click();
  await page.getByRole("button", { name: "确认发送并开始" }).click();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(1);
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  await expect(page.getByRole("heading", { name: summary.result.title })).toBeVisible();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(1);
  expect(errors).toEqual([]);
});
