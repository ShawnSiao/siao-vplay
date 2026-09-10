import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const width of [1440, 960]) {
  test(`drawer content remains readable at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/e2e/player.html");
    await page.evaluate(() => {
      (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
        if (command === "get_codex_runtime_status") return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
        if (command === "get_ai_service_settings") return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        if (["list_explanation_tasks", "list_explanations", "list_learning_tasks", "list_dictionary_entries", "list_learning_cards", "list_speech_voices", "list_analysis_prompt_templates"].includes(command)) return [];
        throw new Error(`Unexpected fixture IPC: ${command}`);
      } };
    });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: /^剧集/ }).click();
    const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
    for (const tab of ["剧集", "理解", "学习"]) {
      await drawer.getByRole("tab", { name: tab, exact: true }).click();
      await expect(drawer.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
      if (tab === "学习") await expect(drawer.getByRole("button", { name: "准备查询材料" })).toBeVisible();
      await expect(drawer).not.toContainText("Unexpected fixture IPC");
      await expect(drawer).not.toContainText("Cannot read properties");
      const styles = await drawer.locator(".player-drawer-content *").evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        return { tag: node.tagName, classes: node.className,
          font: style.fontSize, leading: style.lineHeight, padding: style.padding, margin: style.margin,
          display: style.display, columns: style.gridTemplateColumns, rows: style.gridTemplateRows,
          gap: style.gap, color: style.color, background: style.backgroundColor, border: style.borderRadius };
      }));
      expect(styles.length).toBeGreaterThan(3);
      console.info(JSON.stringify({ contentLayout: true, width, tab, styles }));
      if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `drawer-${width}-${tab}.png`) });
    }
    expect(errors).toEqual([]);
  });
}
