import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { createUnderstandingFixtures } from "../src/test-fixtures/understanding";

test("understanding loads original evidence, retries reads and pauses before seeking", async ({ page }) => {
  const { explanationTask: task, explanation } = createUnderstandingFixtures({ projectId: "e2e-project", sourceVersionId: "e2e-original", translationVersionId: "", sourceSegmentId: "e2e-original-segment" });
  task.playbackCutoffMs = explanation.playbackCutoffMs = 15_000;
  explanation.materialSummary.endMs = 15_000;
  task.status = "completed"; task.outputExplanationId = explanation.id;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ task, explanation }) => {
    let reads = 0;
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; evidenceReads: number };
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: false };
        case "get_ai_service_settings": return { services: [], defaultServiceId: null };
        case "list_explanation_tasks": return [task];
        case "list_explanations": return [explanation];
        case "get_explanation_evidence":
          state.evidenceReads = ++reads;
          if (reads === 1) throw new Error("temporarily unavailable");
          return { explanationId: explanation.id, taskId: task.id, projectId: task.projectId, sourceVersionId: task.sourceVersionId, playbackCutoffMs: 15000,
            subtitles: [{ segmentId: task.authorizedSegmentIds[0], startMs: 2000, endMs: 3000, text: "駅の前で会おう。" }],
            frames: [{ id: task.frames[0].id, timestampMs: 14000 }] };
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  }, { task, explanation });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/player.html?ai-confirm=explanation");
  await expect(page.getByText(explanation.confirmedFacts[0].text, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新读取证据" }).click();
  await expect(page.getByText("駅の前で会おう。").first()).toBeVisible();
  await expect(page.getByText(/Unexpected fixture IPC/)).toHaveCount(0);
  await expect(page.getByText(/e2e-original-segment|16e2210a/)).toHaveCount(0);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "understanding-evidence-960.png"), fullPage: true });
  await page.getByRole("button", { name: "定位原文 00:02" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("定位结果")).toHaveText("已暂停 · 2000 毫秒");
  expect(await page.evaluate(() => (window as unknown as { evidenceReads: number }).evidenceReads)).toBe(2);
  expect(errors).toEqual([]);
});
