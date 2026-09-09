import { expect, test } from "@playwright/test";
import { createSummaryFixtures } from "../src/test-fixtures/summary";
import { summaryDispatchFixture } from "../src/test-fixtures/summaryDispatch";

for (const outcome of ["completed", "cancelled"] as const) test(`summary polling stops after ${outcome} despite an older read`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { task, summary } = createSummaryFixtures();
  await page.addInitScript(({ task, summary, preview }) => {
    const state = window as unknown as { summarySends: unknown[]; polls: number; finish: () => void; __TAURI_INTERNALS__: unknown };
    state.summarySends = [];
    state.polls = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_summary_tasks": case "list_video_summaries": return [];
        case "list_analysis_prompt_templates": return [];
        case "preview_ai_execution": return { executionKind: "codex", serviceConfigId: null, providerId: null, displayName: "本机 Codex", modelId: null, subtitles: true, currentQuestion: true, framesRequested: false, framesEffective: false, serviceRevision: null };
        case "prepare_summary_task": return { ...task, status: "prepared" };
        case "preview_summary_dispatch": return preview;
        case "start_summary_task": case "resume_summary_task": state.summarySends.push(args); return task;
        case "get_video_summary": return summary;
        case "cancel_summary_task": return { ...task, status: "cancelled", stage: "cancelled", cancelRequested: true };
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
  if (outcome === "cancelled") {
    await page.getByRole("button", { name: "取消总结" }).click();
    await expect(page.getByText(/已取消/)).toBeVisible();
  }
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  if (outcome === "completed") await expect(page.getByRole("heading", { name: summary.result.title })).toBeVisible();
  else {
    await expect(page.getByText(/已取消/)).toBeVisible();
    await expect(page.getByRole("heading", { name: summary.result.title })).toHaveCount(0);
  }
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(1);
  expect(errors).toEqual([]);
});
