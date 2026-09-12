import { expect, test } from "@playwright/test";
import { createLearningTaskFixture } from "../src/test-fixtures/learning";
import { createPlayerSubtitleFixtures } from "../src/e2e/playerSubtitleFixtures";

test("learning keeps one slow read and stops polling after failure", async ({ page }) => {
  const { originalSubtitle: source } = createPlayerSubtitleFixtures("e2e-project");
  const task = { ...createLearningTaskFixture(), projectId: source.projectId, sourceVersionId: source.id,
    sourceSegmentId: source.segments[0].id, selectedText: source.segments[0].text, selectionKind: "sentence", playbackPositionMs: 15000 };
  await page.addInitScript(({ task, source }) => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; polls: number; finish: () => void };
    state.polls = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_learning_tasks": return [task];
        case "get_learning_task": state.polls++; return new Promise(resolve => { state.finish = () => resolve({ ...task, status: "failed", errorMessage: "测试任务已终止" }); });
        case "get_subtitle_version": return source;
        case "list_dictionary_entries": case "list_learning_cards": case "list_speech_voices": return [];
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, source });
  await page.clock.install();
  await page.goto("/e2e/player.html?ai-confirm=learning");
  await expect(page.getByRole("button", { name: /^取消$/ })).toBeVisible();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(1);
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  await expect(page.getByRole("strong").filter({ hasText: "测试任务已终止" })).toBeVisible();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(1);
});
