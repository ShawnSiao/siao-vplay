import { expect, test } from "@playwright/test";
import { verifyKeyboardReachability } from "./keyboardReachability";

test("saved cards remain keyboard reachable and a failed deletion can be retried", async ({ page }) => {
  const cards = [0, 1].map(index => ({ id: `card-${index}`, projectId: "e2e-project",
    dictionaryEntryId: null, sourceVersionId: "e2e-original", translationVersionId: null,
    sourceSegmentId: "e2e-original-segment", selectedText: `Saved sentence ${index}`, selectionKind: "sentence",
    pronunciation: "", partOfSpeech: "", contextualMeaning: "已保存释义", usageNote: null,
    sourceSentence: `Saved sentence ${index}`, translatedSentence: null, languageCode: "en",
    screenshotPath: "W:/isolated/card.jpg", screenshotSha256: "a".repeat(64), createdAtMs: 1, updatedAtMs: 1,
    screenshotAvailable: false, playbackPositionMs: 2000 + index * 1000 }));
  await page.addInitScript(cards => {
    let attempts = 0;
    let selections = 0;
    const host = window as unknown as { __TAURI_INTERNALS__: unknown; deletions: unknown[]; exports: unknown[] };
    host.deletions = [];
    host.exports = [];
    host.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: false, authenticated: false, supported: false, version: null,
          minimumVersion: "0.100.0", authMode: null, errorCode: "codex_runtime_unavailable", errorMessage: "未找到 Codex" };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_learning_tasks": case "list_dictionary_entries": case "list_speech_voices": return [];
        case "list_learning_cards": return cards;
        case "plugin:dialog|open": return ++selections === 1 ? null : "W:/isolated/export";
        case "export_learning_cards": host.exports.push(args); return { directory: "W:/isolated/export", jsonPath: "W:/isolated/export/cards.json", markdownPath: "W:/isolated/export/cards.md", cardCount: 2 };
        case "delete_learning_card":
          host.deletions.push(args);
          if (++attempts === 1) throw new Error("删除暂时失败，请重试");
          return true;
        default: throw new Error(`Unexpected isolated IPC: ${command}`);
      }
    } };
  }, cards);
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/player.html?ai-confirm=learning&drawer");
  const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
  const first = drawer.locator(".learning-card").filter({ hasText: "Saved sentence 0" });
  const second = drawer.locator(".learning-card").filter({ hasText: "Saved sentence 1" });
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  await verifyKeyboardReachability(page, drawer);
  await first.getByRole("button", { name: "跳回", exact: true }).press("Enter");
  await expect(page.getByLabel("定位结果")).toContainText("2000 毫秒");
  await drawer.getByRole("button", { name: "导出", exact: true }).press("Enter");
  expect(await page.evaluate(() => (window as unknown as { exports: unknown[] }).exports)).toEqual([]);
  await drawer.getByRole("button", { name: "导出", exact: true }).press("Enter");
  await expect(drawer.getByText(/已导出 2 张卡片/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { exports: unknown[] }).exports)).toEqual([
    { input: { projectId: "e2e-project", destinationDirectory: "W:/isolated/export" } },
  ]);
  await first.getByRole("button", { name: "删除", exact: true }).press("Enter");
  await expect(drawer.getByRole("alert")).toContainText("删除暂时失败");
  await expect(first).toHaveCount(1);
  await first.getByRole("button", { name: "删除", exact: true }).press("Enter");
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { deletions: unknown[] }).deletions)).toEqual([
    { projectId: "e2e-project", cardId: "card-0" }, { projectId: "e2e-project", cardId: "card-0" },
  ]);
});
