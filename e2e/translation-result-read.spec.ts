import { createPlayerSubtitleFixtures } from "../src/e2e/playerSubtitleFixtures";
import { expect, test } from "@playwright/test";
import { createTranslationTask } from "../src/test-fixtures/translation";

test("completed translation can recover a failed local read without sending again", async ({ page }) => {
  const source = { id: "e2e-original", segments: [{ id: "e2e-original-segment" }] };
  const task = { ...createTranslationTask("e2e-project", source), sourceLanguageCode: "en", handoffKind: "api", status: "completed", outputVersionId: "translated" };
  const { translatedSubtitle } = createPlayerSubtitleFixtures("e2e-project");
  const version = { ...translatedSubtitle, id: "translated", sourceTaskId: task.id,
    segments: translatedSubtitle.segments.map(segment => ({ ...segment, text: "恢复读取的中文字幕" })) };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ task, version }) => {
    const state = window as unknown as { reads: number; unexpected: string[]; __TAURI_INTERNALS__: unknown };
    state.reads = 0; state.unexpected = [];
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: false };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_translation_tasks": return [task];
        case "list_subtitle_versions":
          if (++state.reads === 1) throw new Error("database busy");
          return [version];
        default: state.unexpected.push(command); throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, version });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?translation-confirm=1");
  await expect(page.getByText("翻译已完成，但字幕暂时无法读取。请重试读取。")).toBeVisible();
  await page.getByRole("button", { name: "重新读取字幕" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("恢复读取的中文字幕")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { unexpected: string[] }).unexpected)).toEqual([]);
  expect(errors).toEqual([]);
});
