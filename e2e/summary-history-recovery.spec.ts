import { expect, test } from "@playwright/test";
import { createSummaryFixtures } from "../src/test-fixtures/summary";

test("history retry restores saved summary without starting work or redetecting Codex", async ({ page }) => {
  const { summary } = createSummaryFixtures();
  await page.addInitScript(summary => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; historyReads: number; codexReads: number; sends: number };
    state.historyReads = 0; state.codexReads = 0; state.sends = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_codex_runtime_status") {
        state.codexReads++;
        return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
      }
      if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
      if (command === "list_summary_tasks") {
        if (++state.historyReads === 1) throw new Error("总结记录暂时不可读");
        return [];
      }
      if (command === "list_video_summaries") return [summary];
      if (["prepare_summary_task", "start_summary_task", "resume_summary_task"].includes(command)) state.sends++;
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, summary);
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?summary=confirm");
  await expect(page.getByText("总结记录暂时不可读", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "准备并查看发送清单" })).toHaveCount(0);
  await page.screenshot({ path: "designs/open-source-readiness/summary-history-recovery-960.png" });
  await page.getByRole("button", { name: "重新读取总结记录" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: summary.result.title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const state = window as unknown as { historyReads: number; codexReads: number; sends: number };
    return [state.historyReads, state.codexReads, state.sends];
  })).toEqual([2, 1, 0]);
});
