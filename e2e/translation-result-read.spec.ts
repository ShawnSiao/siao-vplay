import { createPlayerSubtitleFixtures } from "../src/e2e/playerSubtitleFixtures";
import { expect, test } from "@playwright/test";
import { createTranslationTask } from "../src/test-fixtures/translation";

for (const failure of ["result", "history"]) test(`completed translation recovers failed ${failure} reading without sending again`, async ({ page }) => {
  const source = { id: "e2e-original", segments: [{ id: "e2e-original-segment" }] };
  const task = { ...createTranslationTask("e2e-project", source), sourceLanguageCode: "en", handoffKind: "api", status: "completed", outputVersionId: "translated" };
  const { translatedSubtitle } = createPlayerSubtitleFixtures("e2e-project");
  const version = { ...translatedSubtitle, id: "translated", sourceTaskId: task.id,
    segments: translatedSubtitle.segments.map(segment => ({ ...segment, text: "恢复读取的中文字幕" })) };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ task, version, failure }) => {
    const state = window as unknown as { reads: number; historyReads: number; unexpected: string[]; __TAURI_INTERNALS__: unknown };
    state.reads = 0; state.historyReads = 0; state.unexpected = [];
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: false, authenticated: false, supported: false, version: null, minimumVersion: "0.100.0", authMode: null, errorCode: "codex_runtime_unavailable", errorMessage: "未找到 Codex" };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_translation_tasks":
          if (++state.historyReads === 1 && failure === "history") throw new Error("翻译记录暂时不可读");
          return [task];
        case "list_subtitle_versions":
          if (++state.reads === 1 && failure === "result") throw new Error("database busy");
          return [version];
        default: state.unexpected.push(command); throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, version, failure });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?translation-confirm=1");
  await expect(page.getByText(failure === "result" ? "翻译已完成，但字幕暂时无法读取。请重试读取。" : "翻译记录暂时不可读", { exact: true })).toBeVisible();
  if (failure === "history") {
    await expect(page.getByRole("button", { name: "准备翻译材料" })).toHaveCount(0);
    await page.screenshot({ path: "designs/open-source-readiness/translation-history-recovery-960.png" });
  }
  await page.getByRole("button", { name: failure === "result" ? "重新读取字幕" : "重新读取翻译记录" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("恢复读取的中文字幕")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(failure === "result" ? 2 : 1);
  expect(await page.evaluate(() => (window as unknown as { historyReads: number }).historyReads)).toBeGreaterThanOrEqual(failure === "history" ? 2 : 1);
  expect(await page.evaluate(() => (window as unknown as { unexpected: string[] }).unexpected)).toEqual([]);
  expect(errors).toEqual([]);
});
