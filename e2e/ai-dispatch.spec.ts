import { createLearningTaskFixture } from "../src/test-fixtures/learning";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createUnderstandingFixtures } from "../src/test-fixtures/understanding";
import { taskDispatchFixture } from "../src/test-fixtures/taskDispatch";
import type { LearningTask } from "../src/types";

for (const kind of ["explanation", "learning"] as const) {
  test(`${kind} confirms the actual material snapshot before dispatch`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { explanationTask } = createUnderstandingFixtures({ projectId: "e2e-project", sourceVersionId: "e2e-original", translationVersionId: "", sourceSegmentId: "e2e-original-segment" });
    explanationTask.frames = [];
    explanationTask.playbackCutoffMs = 15_000;
    explanationTask.materialSummary = { subtitleCount: 1, frameCount: 0, startMs: 0, endMs: 15_000 };
    const learningTask: LearningTask = { ...createLearningTaskFixture(), projectId: explanationTask.projectId, sourceVersionId: explanationTask.sourceVersionId, status: "queued", sourceSegmentId: "e2e-original-segment", selectedText: "Okay, and that's essentially how the system stores the new memories.", selectionKind: "sentence", playbackPositionMs: 15_000, outputDictionaryEntryId: null };
    const task = kind === "learning" ? learningTask : explanationTask;
    const preview = taskDispatchFixture(task);
    // The fixture carries common metadata; learning only sends the current sentence.
    preview.taskKind = kind;
    preview.selectedText = kind === "learning" ? learningTask.selectedText : null;
    await page.addInitScript(({ task, preview }) => {
      const state = window as unknown as { sends: unknown[]; __TAURI_INTERNALS__: unknown };
      state.sends = [];
      state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
        switch (command) {
          case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
          case "get_ai_service_settings": return { schemaVersion: 1, revision: 0, providerCatalog: { schemaVersion: 1, providers: [] }, services: [], defaultServiceId: null };
          case "list_explanation_tasks": case "list_explanations": case "list_learning_tasks":
          case "list_dictionary_entries": case "list_learning_cards": case "list_analysis_prompt_templates": case "list_speech_voices": return [];
          case "prepare_explanation_task": case "prepare_learning_task": return task;
          case "preview_ai_task_dispatch": return preview;
          case "start_codex_explanation_task": case "start_codex_learning_task":
            state.sends.push(args); return { ...task, status: "running" };
          case "get_explanation_task": case "get_learning_task": return { ...task, status: "running" };
          default: throw new Error(`Unexpected fixture IPC: ${command}`);
        }
      } };
    }, { task, preview });
    await page.setViewportSize({ width: 960, height: 720 });
    await page.goto(`/e2e/player.html?ai-confirm=${kind}`);
    await page.getByRole("button", { name: kind === "explanation" ? "准备理解材料" : "准备查询材料" }).click();
    const confirmation = page.getByRole("region", { name: "本次发送清单" });
    await expect(confirmation.getByText("OpenAI（经本机 Codex）", { exact: true })).toBeVisible();
    await expect(confirmation.getByText("本次不发送图片。")).toBeVisible();
    await expect(page.getByText(/Unexpected fixture IPC/)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { sends: unknown[] }).sends)).toEqual([]);
    await expect.poll(() => confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `${kind}-confirm-960.png`), fullPage: true });
    await confirmation.getByRole("button", { name: "返回任务" }).click();
    await expect(page.getByRole("button", { name: "取消本次准备" })).toBeEnabled();
    await page.getByRole("button", { name: "查看发送清单" }).click();
    const send = confirmation.getByRole("button", { name: kind === "explanation" ? "确认发送并理解" : "确认发送并查询" });
    await send.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => (window as unknown as { sends: unknown[] }).sends.length)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { sends: unknown[] }).sends)).toEqual([
      { input: { taskId: task.id }, confirmationSha256: preview.confirmationSha256 },
    ]);
    expect(errors).toEqual([]);
  });
}
