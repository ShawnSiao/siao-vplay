import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { createUnderstandingFixtures } from "../src/test-fixtures/understanding";
import type { DictionaryEntry } from "../src/types";

for (const kind of ["learning", "explanation"]) {
  for (const state of ["empty", "loading", "failed", "long"]) {
    for (const width of [480, 960, 1440]) {
      test(`${kind} ${state} at ${width}px`, async ({ page }) => {
        const longText = "这是用于检查长内容阅读和滚动的测试说明。".repeat(100);
        const { explanation } = createUnderstandingFixtures({ projectId: "e2e-project", sourceVersionId: "e2e-original", translationVersionId: "", sourceSegmentId: "e2e-original-segment" });
        explanation.playbackCutoffMs = 15000;
        explanation.confirmedFacts[0].text = longText;
        const sentence = "Okay, and that's essentially how the system stores the new memories.";
        const entry: DictionaryEntry = { id: "long-entry", projectId: "e2e-project", taskId: "long-task", sourceVersionId: "e2e-original", translationVersionId: null,
          sourceSegmentId: "e2e-original-segment", selectedText: sentence, sourceSentence: sentence, selectionKind: "sentence", pronunciation: "", partOfSpeech: "句子",
          contextualMeaning: longText, usageNote: "长内容结束", translatedSentence: null, languageCode: "en", playbackPositionMs: 15000, createdAtMs: 1 };
        await page.addInitScript(({ state, kind, explanation, entry }) => {
          const host = window as unknown as { __TAURI_INTERNALS__: unknown; failRead: boolean };
          host.failRead = state === "failed";
          host.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
            if (command === "get_codex_runtime_status") return { available: false, authenticated: false, supported: false, version: null, minimumVersion: "0.100.0", authMode: null, errorCode: "codex_runtime_unavailable", errorMessage: "未找到 Codex" };
            if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
            if (command === `list_${kind}_tasks`) {
              if (state === "loading") return new Promise(() => {});
              if (host.failRead) throw new Error("历史记录暂时无法读取");
              return [];
            }
            if (state === "long" && command === "list_dictionary_entries") return [entry];
            if (state === "long" && command === "list_explanations") return [explanation];
            if (command === "get_explanation_evidence") return { explanationId: explanation.id, taskId: explanation.taskId, projectId: explanation.projectId,
              sourceVersionId: explanation.sourceVersionId, playbackCutoffMs: 15000, subtitles: [], frames: [] };
            if (["list_analysis_prompt_templates", "list_dictionary_entries", "list_learning_cards", "list_speech_voices", "list_explanations"].includes(command)) return [];
            throw new Error(`Unexpected fixture IPC: ${command}`);
          } };
        }, { state, kind, explanation, entry });
        await page.setViewportSize({ width, height: width === 480 ? 320 : 720 });
        await page.goto(`/e2e/player.html?ai-confirm=${kind}&drawer${state === "empty" ? "&no-source" : ""}`);
        const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
        if (state === "empty") {
          const action = drawer.getByRole("button", { name: "生成或导入原文字幕" });
          await action.focus();
          await expect(action).toBeInViewport();
        } else if (state === "loading") {
          await expect(drawer.getByRole("status").filter({ hasText: "正在读取" })).toBeVisible();
        } else if (state === "long") {
          await expect(drawer.getByText(longText, { exact: true })).toHaveCount(1);
          const scroll = drawer.locator(kind === "learning" ? ".learning-scroll" : ".understanding-scroll");
          await scroll.evaluate(node => { node.scrollTop = 0; });
          await scroll.hover();
          await page.mouse.wheel(0, 600);
          await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
          const action = drawer.getByRole("button", { name: kind === "learning" ? "查询其他内容" : "理解当前播放位置", exact: true });
          await action.focus();
          await expect(action).toBeInViewport();
        } else {
          await expect(drawer.getByRole("alert")).toContainText("历史记录暂时无法读取");
          await expect(drawer.getByRole("button", { name: /准备.*材料/ })).toHaveCount(0);
          const retry = drawer.getByRole("button", { name: kind === "learning" ? "重新读取学习记录" : "重新读取场景理解" });
          await retry.focus();
          await expect(retry).toBeInViewport();
          await page.evaluate(() => { (window as unknown as { failRead: boolean }).failRead = false; });
          await retry.press("Enter");
          await expect(drawer.getByRole("alert")).toHaveCount(0);
          await expect(drawer.getByRole("button", { name: /准备.*材料/ })).toHaveCount(1);
        }
        expect(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `${kind}-${state}-${width}.png`) });
      });
    }
  }
}
