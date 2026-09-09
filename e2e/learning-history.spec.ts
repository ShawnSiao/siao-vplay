import { expect, test } from "@playwright/test";
import { dictionaryEntryFixture } from "../src/test-fixtures/dictionary";
import { createPlayerSubtitleFixtures } from "../src/e2e/playerSubtitleFixtures";

test("learning selects the matching subtitle revision rather than the first old result", async ({ page }) => {
  const { originalSubtitle: source } = createPlayerSubtitleFixtures("e2e-project");
  const entry = { ...dictionaryEntryFixture, projectId: source.projectId, sourceVersionId: source.id,
    sourceSegmentId: source.segments[0].id, selectedText: source.segments[0].text, sourceSentence: source.segments[0].text,
    contextualMeaning: "当前版本的词条", selectionKind: "sentence", translationVersionId: null };
  await page.addInitScript(entry => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_learning_tasks": case "list_learning_cards": case "list_speech_voices": return [];
        case "list_dictionary_entries": return [{ ...entry, id: "stale", sourceVersionId: "old-source", contextualMeaning: "旧版本的词条" }, entry];
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, entry);
  await page.goto("/e2e/player.html?ai-confirm=learning");
  await expect(page.getByText("当前版本的词条", { exact: true })).toBeVisible();
  await expect(page.getByText("旧版本的词条", { exact: true })).toHaveCount(0);
});
