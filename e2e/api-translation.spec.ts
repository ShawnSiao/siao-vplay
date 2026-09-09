import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { createTranslationTask, translationDispatchFixture } from "../src/test-fixtures/translation";

test("API translation confirms the receiver and retries without requiring Codex", async ({ page }) => {
  const source = { id: "e2e-original", versionNumber: 1, segments: [{ id: "e2e-original-segment", startMs: 0, endMs: 20_000 }] };
  const task = { ...createTranslationTask("e2e-project", source), handoffKind: "api" as const, sourceLanguageCode: "en" };
  const preview = { ...translationDispatchFixture(task, source), receiver: "https://translation.example.invalid/v1", model: "translation-model" };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ task, preview }) => {
    const state = window as unknown as { sends: unknown[]; preparations: unknown[]; __TAURI_INTERNALS__: unknown };
    state.sends = []; state.preparations = [];
    let current = task;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: false, authenticated: false, supported: false };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 3, providerCatalog: { schemaVersion: 1, providers: [] }, defaultServiceId: "service-1", services: [{ id: "service-1", providerId: "openai", protocol: "openai_responses", baseUrl: "https://translation.example.invalid/v1", connectionState: "ready", isDefault: true, displayName: "测试翻译服务", modelId: "translation-model", credentialState: "stored", revision: 3, capabilities: { understanding: true, learning: true, vision: false } }] };
        case "list_translation_tasks": return [];
        case "prepare_api_translation": state.preparations.push(args); return current;
        case "preview_translation_dispatch": return preview;
        case "start_api_translation": state.sends.push(args); current = { ...task, status: "running", stage: "translating_batches" }; return current;
        case "cancel_translation_task": current = { ...task, status: "cancelled", stage: "cancelled" }; return current;
        case "get_translation_task": return current;
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, preview });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?translation-confirm=1");
  await expect(page.getByLabel("接收服务")).toHaveValue("service-1");
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "api-translation-setup-960.png"), fullPage: true });
  await page.getByRole("button", { name: "准备翻译材料" }).click();
  const confirmation = page.getByRole("region", { name: "翻译发送清单" });
  await expect(confirmation.getByText(preview.receiver, { exact: true })).toBeVisible();
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "api-translation-confirm-960.png"), fullPage: true });
  expect(await page.evaluate(() => (window as unknown as { sends: unknown[] }).sends.length)).toBe(0);
  await confirmation.getByRole("button", { name: "确认发送并翻译" }).click();
  await expect(page.getByText("正在分批翻译，已完成批次会保留")).toBeVisible();
  await page.getByRole("button", { name: "取消翻译", exact: true }).click();
  await page.getByRole("button", { name: "重试未完成批次" }).click();
  await confirmation.getByRole("button", { name: "确认发送并翻译" }).click();
  expect(await page.evaluate(() => (window as unknown as { sends: unknown[] }).sends)).toEqual([
    { input: { taskId: task.id, confirmationSha256: preview.confirmationSha256 } },
    { input: { taskId: task.id, confirmationSha256: preview.confirmationSha256 } },
  ]);
  expect(errors).toEqual([]);
});
