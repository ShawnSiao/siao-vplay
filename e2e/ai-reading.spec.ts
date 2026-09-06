import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const zoom of [1, 1.25, 1.5]) {
  test(`AI sending explanations remain readable at CSS layout scale ${zoom}`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
        if (command === "get_codex_runtime_status") return { available: true, authenticated: true, supported: true };
        if (command === "get_ai_service_settings") return { services: [], defaultServiceId: null };
        if (["list_learning_tasks", "list_dictionary_entries", "list_learning_cards", "list_speech_voices"].includes(command)) return [];
        throw new Error(`Unexpected fixture IPC: ${command}`);
      } };
    });
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto("/e2e/player.html?ai-confirm=learning");
    await page.getByRole("button", { name: "准备查询材料" }).waitFor();
    await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, zoom);
    const confirmation = page.getByRole("region", { name: "学习辅助发送确认" });
    await confirmation.scrollIntoViewIfNeeded();
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `ai-reading-${zoom}.png`) });
    const text = await confirmation.locator(".ai-execution-choices small, .ai-execution-scope p, .ai-execution-scope li, .ai-no-fallback").evaluateAll((elements) => elements.map((element) => ({
      text: element.textContent, size: parseFloat(getComputedStyle(element).fontSize), overflow: element.scrollWidth > element.clientWidth + 1,
    })));
    expect(text.length).toBeGreaterThan(5);
    expect(text.filter((item) => item.size < 12 || item.overflow)).toEqual([]);
    await page.getByRole("button", { name: /复制提示词/ }).click();
    await expect(page.getByRole("button", { name: /复制提示词/ })).toHaveClass("selected");
    const submit = page.getByRole("button", { name: "准备查询材料" });
    await submit.focus();
    await expect(submit).toBeFocused();
    expect(await page.locator(".learning-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}


test("sending explanations fit the actual narrow learning drawer", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/player.html");
  await page.getByRole("button", { name: "更多", exact: true }).waitFor();
  await page.evaluate(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_codex_runtime_status") return { available: true, authenticated: true, supported: true };
      if (command === "get_ai_service_settings") return { services: [], defaultServiceId: null };
      if (["list_learning_tasks", "list_dictionary_entries", "list_learning_cards", "list_speech_voices"].includes(command)) return [];
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  });
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: /^剧集/ }).click();
  await page.getByRole("tab", { name: "学习", exact: true }).click();
  const scope = page.locator(".ai-execution-scope");
  await scope.scrollIntoViewIfNeeded();
  expect((await page.locator(".player-drawer").boundingBox())!.width).toBeLessThanOrEqual(420);
  expect(await scope.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "ai-reading-drawer-960.png") });
  await page.getByRole("button", { name: "准备查询材料" }).focus();
  await expect(page.getByRole("button", { name: "准备查询材料" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "进入环境配置添加 AI 服务" })).toBeFocused();
});
