import { expect, test } from "@playwright/test";

for (const [tab, action] of [["理解", "准备理解材料"], ["学习", "准备查询材料"]]) {
  test(`${tab} reads history independently and retries only Codex detection`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 960, height: 720 });
    await page.goto("/e2e/player.html");
    await page.evaluate(() => {
      const state = window as unknown as { __TAURI_INTERNALS__: unknown; detectionCalls: number; historyCalls: number };
      state.detectionCalls = 0;
      state.historyCalls = 0;
      state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
        if (command === "get_codex_runtime_status") {
          state.detectionCalls++;
          if (state.detectionCalls === 1) throw new Error("isolated detection failure");
          return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
        }
        if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        if (["list_explanation_tasks", "list_explanations", "list_learning_tasks", "list_dictionary_entries", "list_learning_cards"].includes(command)) { state.historyCalls++; return []; }
        if (["list_speech_voices", "list_analysis_prompt_templates"].includes(command)) return [];
        throw new Error(`Unexpected fixture IPC: ${command}`);
      } };
    });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: /^剧集/ }).click();
    const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
    await drawer.getByRole("tab", { name: tab, exact: true }).click();
    await expect(drawer.getByRole("button", { name: action, exact: true })).toBeVisible();
    const retry = drawer.getByRole("button", { name: "重新检测 Codex" });
    await expect(retry).toBeVisible();
    expect(await retry.evaluate(element => Boolean(element.closest(".learning-scroll, .understanding-scroll")))).toBe(true);
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `designs/open-source-readiness/codex-recovery-${tab}.png` });
    const historyCalls = await page.evaluate(() => (window as unknown as { historyCalls: number }).historyCalls);
    expect(historyCalls).toBeGreaterThan(0);
    await retry.click();
    await expect(retry).not.toBeVisible();
    await expect(drawer.getByRole("button", { name: action, exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { historyCalls: number }).historyCalls)).toBe(historyCalls);
    expect(await page.evaluate(() => (window as unknown as { detectionCalls: number }).detectionCalls)).toBe(2);
    expect(errors).toEqual([]);
  });
}
