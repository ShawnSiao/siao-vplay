import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { createSummaryFixtures } from "../src/test-fixtures/summary";

for (const width of [480, 960, 1440]) {
  for (const state of ["empty", "loading", "failed", "long"] as const) {
    test(`summary ${state} remains readable and reachable at ${width}px`, async ({ page }) => {
      const { task, summary } = createSummaryFixtures();
      task.status = "failed";
      task.errorMessage = "网络连接中断，已完成的片段仍然保留。";
      summary.result.overview = "这是用于验证长段落换行与滚动的测试说明。".repeat(80);
      await page.addInitScript(({ state, task, summary }) => {
        const host = window as unknown as { __TAURI_INTERNALS__: unknown };
        host.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
          switch (command) {
            case "get_ai_service_settings": return { services: [], defaultServiceId: null };
            case "get_codex_runtime_status": return { available: false };
            case "list_summary_tasks": return state === "loading" ? new Promise(() => {}) : state === "failed" ? [task] : [];
            case "list_video_summaries": return state === "long" ? [summary] : [];
            default: throw new Error(`Unexpected fixture IPC: ${command}`);
          }
        } };
      }, { state, task, summary });
      await page.setViewportSize({ width, height: width === 480 ? 320 : 720 });
      await page.goto(`/e2e/player.html?summary=${state === "empty" ? "empty" : "confirm"}&drawer`);
      const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
      if (state === "loading") await expect(drawer.getByRole("status")).toHaveText("正在读取视频总结");
      else if (state === "empty") {
        const action = drawer.getByRole("button", { name: "生成或导入原文字幕" });
        await action.focus();
        await expect(action).toBeInViewport();
      } else if (state === "failed") {
        await expect(drawer.getByRole("alert")).toHaveText(task.errorMessage!);
        const retry = drawer.getByRole("button", { name: "继续总结", exact: true });
        await retry.focus();
        await expect(retry).toBeInViewport();
      } else {
        const body = drawer.locator(".summary-overview-copy p").first();
        await expect(body).toHaveText(summary.result.overview);
        const exportButton = drawer.getByRole("button", { name: /保存.*Markdown/ });
        await exportButton.focus();
        await expect(exportButton).toBeInViewport();
      }
      if (width === 480) expect((await drawer.locator(".understanding-tab-content").boundingBox())!.height).toBeGreaterThanOrEqual(140);
      expect(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `summary-state-${state}-${width}.png`) });
    });
  }
}
