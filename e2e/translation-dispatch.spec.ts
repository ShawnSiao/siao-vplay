import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createTranslationTask, translationDispatchFixture } from "../src/test-fixtures/translation";

test("translation prepares without sending and confirms the actual range before start", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = { id: "e2e-original", versionNumber: 1, segments: [{ id: "e2e-original-segment", startMs: 0, endMs: 20_000 }] };
  const task = createTranslationTask("e2e-project", source);
  const preview = translationDispatchFixture(task, source);
  await page.addInitScript(({ task, preview }) => {
    const state = window as unknown as { sends: unknown[]; __TAURI_INTERNALS__: unknown };
    state.sends = [];
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_translation_tasks": return [];
        case "prepare_translation_task": return task;
        case "preview_translation_dispatch": return preview;
        case "start_codex_translation_task": state.sends.push(args); return { ...task, status: "running", stage: "starting" };
        case "get_translation_task": return state.sends.length ? { ...task, status: "running", stage: "starting" } : task;
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, preview });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?translation-confirm=1");
  await page.getByRole("button", { name: "准备翻译材料" }).click();
  const confirmation = page.getByRole("region", { name: "翻译发送清单" });
  await expect(confirmation.getByText(preview.receiver, { exact: true })).toBeVisible();
  await expect(confirmation.getByText(/完整字幕 · 1 条/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { sends: unknown[] }).sends)).toEqual([]);
  await expect.poll(() => confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "translation-confirm-960.png"), fullPage: true });
  await confirmation.getByRole("button", { name: "返回任务" }).click();
  await expect(page.getByRole("button", { name: "取消任务" })).toBeEnabled();
  await page.getByRole("button", { name: "查看发送清单" }).click();
  const send = confirmation.getByRole("button", { name: "确认发送并翻译" });
  await send.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { sends: unknown[] }).sends.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { sends: unknown[] }).sends)).toEqual([{ input: { taskId: task.id }, confirmationSha256: preview.confirmationSha256 }]);
  expect(errors).toEqual([]);
});
