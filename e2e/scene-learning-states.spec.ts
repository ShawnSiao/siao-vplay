import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const kind of ["learning", "explanation"]) {
  for (const state of ["empty", "loading", "failed"]) {
    for (const width of [480, 960, 1440]) {
      test(`${kind} ${state} at ${width}px`, async ({ page }) => {
        await page.addInitScript(({ state, kind }) => {
          const host = window as unknown as { __TAURI_INTERNALS__: unknown; failRead: boolean };
          host.failRead = state === "failed";
          host.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
            if (command === "get_codex_runtime_status") return { available: false };
            if (command === "get_ai_service_settings") return { services: [], defaultServiceId: null };
            if (command === `list_${kind}_tasks`) {
              if (state === "loading") return new Promise(() => {});
              if (host.failRead) throw new Error("历史记录暂时无法读取");
              return [];
            }
            if (["list_analysis_prompt_templates", "list_dictionary_entries", "list_learning_cards", "list_speech_voices", "list_explanations"].includes(command)) return [];
            throw new Error(`Unexpected fixture IPC: ${command}`);
          } };
        }, { state, kind });
        await page.setViewportSize({ width, height: width === 480 ? 320 : 720 });
        await page.goto(`/e2e/player.html?ai-confirm=${kind}&drawer${state === "empty" ? "&no-source" : ""}`);
        const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
        if (state === "empty") {
          const action = drawer.getByRole("button", { name: "生成或导入原文字幕" });
          await action.focus();
          await expect(action).toBeInViewport();
        } else if (state === "loading") {
          await expect(drawer.getByRole("status").filter({ hasText: "正在读取" })).toBeVisible();
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
