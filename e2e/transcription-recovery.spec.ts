import { join } from "node:path";
import { expect, test } from "@playwright/test";
for (const mode of ["runtime", "history"]) test(`transcription recovers ${mode} without starting a task`, async ({ page }) => {
  await page.addInitScript(mode => {
    const state = window as unknown as { recovered: boolean; starts: number; __TAURI_INTERNALS__: unknown };
    state.recovered = false; state.starts = 0;
    const job = { id: "job", projectId: "project", status: "transcribing", stage: "transcribing", progress: 0.4, languageCode: "en", modelKind: "small", runtimeBackend: "cpu", runtimeVersion: "1", subtitleVersionId: null, errorCode: null, errorMessage: null, createdAtMs: 1, updatedAtMs: 1, startedAtMs: 1, completedAtMs: null };
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "get_transcription_runtime_status") {
        if (mode === "runtime" && !state.recovered) return { available: true };
        return { available: true, preferredBackend: "cpu", runtimes: [{ backend: "cpu", available: true, path: "W:/runtime", version: "1", errorMessage: null }], models: [{ modelKind: "small", available: true, path: "W:/model", errorMessage: null }] };
      }
      if (command === "list_transcription_jobs") {
        if (mode === "history" && !state.recovered) throw new Error("任务记录读取失败");
        return mode === "runtime" ? [job] : [];
      }
      if (command === "get_transcription_job") return job;
      if (command === "start_transcription") { state.starts++; throw new Error("must not start"); }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, mode);
  await page.goto("/e2e/runtime.html?transcription");
  const retry = page.getByRole("button", { name: "重新检查" });
  await expect(retry).toBeEnabled();
  if (mode === "runtime") await expect(page.getByRole("button", { name: "取消生成" })).toBeEnabled();
  else {
    await page.getByLabel(/视频原声语言/).selectOption("ja");
    await expect(page.getByRole("button", { name: "生成原文字幕" })).toBeDisabled();
  }
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `transcription-recovery-${mode}.png`), fullPage: true });
  await page.evaluate(() => { (window as unknown as { recovered: boolean }).recovered = true; });
  await retry.click();
  await expect(retry).toHaveCount(0);
  if (mode === "history") await expect(page.getByRole("button", { name: "生成原文字幕" })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { starts: number }).starts)).toBe(0);
});
