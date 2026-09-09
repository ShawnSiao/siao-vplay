import { expect, test } from "@playwright/test";
import { createUnderstandingFixtures } from "../src/test-fixtures/understanding";
import { taskDispatchFixture } from "../src/test-fixtures/taskDispatch";

test("an API task remains cancellable after confirmation and displays acknowledgement", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { explanationTask: task } = createUnderstandingFixtures({ projectId: "e2e-project", sourceVersionId: "e2e-original", translationVersionId: "", sourceSegmentId: "e2e-original-segment" });
  task.handoffKind = "api";
  task.execution = { ...task.execution, kind: "api", serviceConfigId: "fixture-service", serviceRevision: 1, providerId: "openai-compatible", modelId: "fixture-model" };
  task.frames = [];
  task.playbackCutoffMs = 15_000;
  task.materialSummary = { subtitleCount: 1, frameCount: 0, startMs: 0, endMs: 15_000 };
  const preview = taskDispatchFixture(task);
  preview.execution = { kind: "api", serviceConfigId: "fixture-service", modelId: "fixture-model" };
  preview.authorization.serviceRevision = 1;
  preview.receiver = "测试服务";
  preview.endpoint = "https://example.invalid";
  await page.addInitScript(({ task, preview }) => {
    let current = task;
    const state = window as unknown as { sends: unknown[]; __TAURI_INTERNALS__: unknown };
    state.sends = [];
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: false, authenticated: false, supported: false, version: null, minimumVersion: "0.100.0", authMode: null, errorCode: "codex_runtime_unavailable", errorMessage: "未找到 Codex" };
        case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
        case "list_explanation_tasks": return [current];
        case "list_explanations": case "list_analysis_prompt_templates": return [];
        case "preview_ai_task_dispatch": return preview;
        case "resume_explanation_task": state.sends.push(args); current = { ...current, status: "running", stage: "running" }; return current;
        case "cancel_explanation_task": current = { ...current, stage: "cancelling" }; return current;
        case "get_explanation_task": if (current.stage === "cancelling") current = { ...current, status: "cancelled", stage: "cancelled" }; return current;
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, preview });
  await page.goto("/e2e/player.html?ai-confirm=explanation");
  await page.getByRole("button", { name: "查看发送清单" }).click();
  await page.getByRole("button", { name: "确认发送并理解" }).click();
  const cancel = page.getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(page.getByText("正在取消请求…")).toBeVisible();
  await expect(page.getByText("本次理解已取消")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { sends: unknown[] }).sends.length)).toBe(1);
  expect(errors).toEqual([]);
});
