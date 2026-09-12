import { expect, test } from "@playwright/test";
import { createBurnJobFixture } from "../src/test-fixtures/burn";
for (const wrongIdentity of [true, false]) {
  test(`burn output requires the requested job identity: mismatch=${wrongIdentity}`, async ({ page }) => {
    const job = { ...createBurnJobFixture(), projectId: "e2e-project", translationVersionId: "burn-translation" };
    await page.addInitScript(({ job, wrongIdentity }) => {
      const state = window as unknown as { __TAURI_INTERNALS__: unknown; cancelled: string[] };
      state.cancelled = [];
      state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: { input?: { jobId: string } }) => {
        if (command === "list_subtitle_burn_jobs") return [job];
        if (command === "get_subtitle_burn_job") return { ...job, id: wrongIdentity ? "other-job" : job.id, status: "completed", progress: 1,
          outputPath: "fixture-output.mp4", manifestPath: "fixture-output.json", outputSha256: "a".repeat(64) };
        if (command === "cancel_subtitle_burn_job") { state.cancelled.push(args.input!.jobId); return { ...job, status: "cancelled" }; }
        throw new Error(`Unexpected fixture IPC: ${command}`);
      } };
    }, { job, wrongIdentity });
    await page.goto("/e2e/player.html?burn");
    if (wrongIdentity) {
      await expect(page.getByText("字幕烧录任务格式无效或与当前请求、字幕选择不匹配。", { exact: true })).toBeVisible();
      await expect(page.getByText("fixture-output.mp4", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "取消烧录", exact: true }).click();
      await expect(page.getByRole("heading", { name: "任务已取消", exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { cancelled: string[] }).cancelled)).toEqual([job.id]);
    } else {
      await expect(page.getByText("fixture-output.mp4", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "继续导出", exact: true })).toBeVisible();
    }
    await expect(page.getByText(/Unexpected fixture IPC/)).toHaveCount(0);
  });
}
