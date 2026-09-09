import { expect, test, type Page } from "@playwright/test";

async function installRecoveryFixture(page: Page, status = "interrupted") {
  await page.addInitScript((status) => {
    const task = { id: "old-task", projectId: "e2e-project", handoffKind: "codex", status, stage: "interrupted",
      sourceVersionId: "historical-original", translationVersionId: null, sourceSegmentId: "old-line", selectedText: "Historical",
      selectionKind: "word", playbackPositionMs: 6000, progress: 0, outputDictionaryEntryId: null };
    const source = { id: "historical-original", projectId: "e2e-project", role: "original", languageCode: "en", versionNumber: 1,
      segments: [{ id: "old-line", text: "Historical sentence.", startMs: 5000, endMs: 7000, words: [], sourceSegmentId: null }] };
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; reads: number; failRead: boolean };
    state.reads = 0;
    state.failRead = true;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_learning_tasks": return [task];
        case "get_learning_task": return { ...task };
        case "cancel_learning_task": task.status = "cancelled"; return { ...task };
        case "list_dictionary_entries": case "list_learning_cards": case "list_speech_voices": return [];
        case "get_subtitle_version": state.reads++; if (state.failRead) throw new Error("历史字幕暂时无法读取"); return source;
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, status);
}

test("restored learning uses the historical sentence and cutoff, then permits an explicit new context", async ({ page }) => {
  await installRecoveryFixture(page);
  await page.goto("/e2e/player.html?ai-confirm=learning");
  await expect(page.getByText("历史字幕暂时无法读取", { exact: false })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "要查询的原文" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新开始", exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { failRead: boolean }).failRead = false; });
  await page.getByRole("button", { name: "重新读取学习上下文" }).click();
  await expect(page.getByLabel("选择原文词语")).toHaveText("Historical sentence.");
  await expect(page.locator(".learning-selection-heading")).toContainText("00:06");
  await expect(page.getByRole("textbox", { name: "要查询的原文" })).toHaveValue("Historical");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "学习当前台词" }).click();
  await expect(page.getByRole("textbox", { name: "要查询的原文" })).toHaveValue("Okay, and that's essentially how the system stores the new memories.");
  await expect(page.getByRole("button", { name: "准备查询材料" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(2);
});


test("a running task can be cancelled even if its historical context cannot be read", async ({ page }) => {
  await installRecoveryFixture(page, "running");
  await page.goto("/e2e/player.html?ai-confirm=learning");
  await expect(page.getByText("历史字幕暂时无法读取", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "放下本次查询，学习当前台词" })).toHaveCount(0);
  await page.getByRole("button", { name: "取消本次查询", exact: true }).click();
  await page.getByRole("button", { name: "放下本次查询，学习当前台词" }).click();
  await expect(page.getByRole("button", { name: "准备查询材料" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "要查询的原文" })).toHaveValue("Okay, and that's essentially how the system stores the new memories.");
});
