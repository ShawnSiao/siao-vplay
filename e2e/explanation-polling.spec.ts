import { expect, test } from "@playwright/test";
import { createUnderstandingFixtures } from "../src/test-fixtures/understanding";
import { createPlayerSubtitleFixtures } from "../src/e2e/playerSubtitleFixtures";

for (const cancel of [false, true]) test(`explanation stops polling after ${cancel ? "cancellation" : "failure"}`, async ({ page }) => {
  const { originalSubtitle: source } = createPlayerSubtitleFixtures("e2e-project");
  const task = { ...createUnderstandingFixtures({ projectId: source.projectId, sourceVersionId: source.id,
    translationVersionId: "", sourceSegmentId: source.segments[0].id }).explanationTask,
    translationVersionId: null, frames: [], status: "running", playbackCutoffMs: 15000 };
  await page.addInitScript(({ task, source }) => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; polls: number; finish: () => void };
    state.polls = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_explanation_tasks": return [task];
        case "get_explanation_task": state.polls++; return new Promise(resolve => { state.finish = () => resolve({ ...task, status: "failed", errorMessage: "测试任务已终止" }); });
        case "get_subtitle_version": return source;
        case "cancel_explanation_task": return { ...task, status: "cancelled", stage: "cancelled" };
        case "list_explanations": case "list_analysis_prompt_templates": return [];
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, source });
  await page.clock.install();
  await page.goto("/e2e/player.html?ai-confirm=explanation");
  await expect(page.getByRole("button", { name: /^取消$/ })).toBeVisible();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(1);
  if (cancel) {
    await page.getByRole("button", { name: /^取消$/ }).click();
    await expect(page.getByText("本次理解已取消")).toBeVisible();
  }
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  await expect(page.getByRole("strong").filter({ hasText: cancel ? "本次理解已取消" : "测试任务已终止" })).toBeVisible();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(1);
});
