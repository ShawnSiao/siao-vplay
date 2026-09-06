import { expect, test } from "@playwright/test";
import { createUnderstandingFixtures } from "../src/test-fixtures/understanding";
import { taskDispatchFixture } from "../src/test-fixtures/taskDispatch";

for (const kind of ["explanation", "learning"] as const) {
  test(`${kind} restores an interrupted task without preparing or sending again`, async ({ page }) => {
    const { explanationTask } = createUnderstandingFixtures({ projectId: "e2e-project", sourceVersionId: "e2e-original", translationVersionId: "", sourceSegmentId: "e2e-original-segment" });
    const task = { ...explanationTask, status: "interrupted", stage: "interrupted", frames: [], playbackCutoffMs: 15_000,
      translationVersionId: null, sourceSegmentId: "e2e-original-segment", selectedText: "Okay", selectionKind: "word", playbackPositionMs: 15_000, outputDictionaryEntryId: null };
    const preview = taskDispatchFixture(task);
    preview.taskKind = kind;
    preview.selectedText = kind === "learning" ? task.selectedText : null;
    await page.addInitScript(({ kind, task, preview }) => {
      const state = window as unknown as { sends: unknown[]; __TAURI_INTERNALS__: unknown };
      state.sends = [];
      state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
        switch (command) {
          case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true };
          case "get_ai_service_settings": return { services: [], defaultServiceId: null };
          case "list_explanation_tasks": return kind === "explanation" ? [task] : [];
          case "list_learning_tasks": return kind === "learning" ? [task] : [];
          case "list_explanations": case "list_dictionary_entries": case "list_learning_cards": case "list_analysis_prompt_templates": case "list_speech_voices": return [];
          case "preview_ai_task_dispatch": return preview;
          case "resume_codex_explanation_task": case "resume_codex_learning_task": state.sends.push(args); return { ...task, status: "running" };
          case "get_explanation_task": case "get_learning_task": return { ...task, status: "running" };
          default: throw new Error(`Unexpected fixture IPC: ${command}`);
        }
      } };
    }, { kind, task, preview });
    await page.goto(`/e2e/player.html?ai-confirm=${kind}`);
    await expect(page.getByText(kind === "explanation" ? "应用上次关闭时尚未完成" : "应用上次关闭时查询尚未完成")).toBeVisible();
    await page.getByRole("button", { name: "重新开始", exact: true }).click();
    await expect(page.getByRole("region", { name: "本次发送清单" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { sends: unknown[] }).sends)).toEqual([]);
    await page.getByRole("button", { name: kind === "learning" ? "确认发送并查询" : "确认发送并理解" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { sends: unknown[] }).sends.length)).toBe(1);
    if (kind === "learning") await expect(page.getByRole("textbox", { name: "要查询的原文" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "取消", exact: true })).toBeEnabled();
    await expect(page.getByText(/Unexpected fixture IPC/)).toHaveCount(0);
  });
}

test("completed understanding can retry a failed result read without sending again", async ({ page }) => {
  const { explanationTask: task, explanation } = createUnderstandingFixtures({ projectId: "e2e-project", sourceVersionId: "e2e-original", translationVersionId: "", sourceSegmentId: "e2e-original-segment" });
  explanation.playbackCutoffMs = 15_000;
  await page.addInitScript(({ task, explanation }) => {
    let reads = 0;
    const state = window as unknown as { __TAURI_INTERNALS__: unknown };
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true };
        case "get_ai_service_settings": return { services: [], defaultServiceId: null };
        case "list_explanation_tasks": return [{ ...task, status: "running" }];
        case "list_explanations": case "list_analysis_prompt_templates": return [];
        case "get_explanation_task": return { ...task, status: "completed", outputExplanationId: explanation.id };
        case "get_explanation": if (++reads === 1) throw new Error("fixture read failure"); return explanation;
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, explanation });
  await page.goto("/e2e/player.html?ai-confirm=explanation");
  await expect(page.getByText("fixture read failure")).toBeVisible();
  await page.getByRole("button", { name: "重新读取结果" }).click({ timeout: 5000 });
  await expect(page.getByText("fixture read failure")).toHaveCount(0);
  await expect(page.getByText(explanation.confirmedFacts[0].text, { exact: true })).toBeVisible();
  await expect(page.getByText(/Unexpected fixture IPC/)).toHaveCount(0);
});
