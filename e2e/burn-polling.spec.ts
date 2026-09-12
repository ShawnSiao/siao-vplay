import { expect, test } from "@playwright/test";
import { createBurnJobFixture } from "../src/test-fixtures/burn";
test("burn retries failed reads, serializes slow reads and clears recovered errors", async ({ page }) => {
  const job = { ...createBurnJobFixture(), projectId: "e2e-project", translationVersionId: "burn-translation" };
  await page.addInitScript(job => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; polls: number; finish: () => void };
    state.polls = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "list_subtitle_burn_jobs") return [job];
      if (command === "get_subtitle_burn_job") {
        if (++state.polls === 1) throw new Error("fixture read failed");
        return new Promise(resolve => { state.finish = () => resolve({ ...job, status: state.polls === 2 ? "running" : "completed", progress: state.polls === 2 ? 0.5 : 1,
          outputPath: "fixture.mp4", manifestPath: "fixture.json", outputSha256: "a".repeat(64) }); });
      }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, job);
  await page.clock.install();
  await page.goto("/e2e/player.html?burn");
  await page.clock.runFor(500);
  await expect(page.getByText("fixture read failed", { exact: true })).toBeVisible();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(2);
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  await expect(page.getByRole("progressbar", { name: "字幕烧录进度" })).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByText("fixture read failed", { exact: true })).toHaveCount(0);
  await page.clock.runFor(500);
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  await expect(page.getByText("fixture.mp4", { exact: true })).toBeVisible();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { polls: number }).polls)).toBe(3);
});

test("successful burn refresh does not hide a cancellation failure", async ({ page }) => {
  const job = { ...createBurnJobFixture(), projectId: "e2e-project", translationVersionId: "burn-translation" };
  await page.addInitScript(job => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "list_subtitle_burn_jobs") return [job];
      if (command === "get_subtitle_burn_job") return job;
      if (command === "cancel_subtitle_burn_job") throw new Error("fixture cancellation failed");
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, job);
  await page.clock.install();
  await page.goto("/e2e/player.html?burn");
  await page.getByRole("button", { name: "取消烧录", exact: true }).click();
  await expect(page.getByText("fixture cancellation failed", { exact: true })).toBeVisible();
  await page.clock.runFor(2000);
  await expect(page.getByText("fixture cancellation failed", { exact: true })).toBeVisible();
});

test("cancelled burn remains cancelled in recent jobs after a late poll", async ({ page }) => {
  const job = { ...createBurnJobFixture(), projectId: "e2e-project", translationVersionId: "burn-translation" };
  await page.addInitScript(job => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; finish?: () => void };
    state.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === "list_subtitle_burn_jobs") return [job];
      if (command === "get_subtitle_burn_job") return new Promise(resolve => { state.finish = () => resolve(job); });
      if (command === "cancel_subtitle_burn_job") return { ...job, status: "cancelled", stage: "cancelled" };
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, job);
  await page.clock.install();
  await page.goto("/e2e/player.html?burn");
  await page.clock.runFor(500);
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finish?: unknown }).finish)).toBe("function");
  await page.getByRole("button", { name: "取消烧录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务已取消" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  await page.getByRole("button", { name: "继续导出" }).click();
  await page.getByRole("button", { name: /最近一次烧录/ }).click();
  await expect(page.getByRole("heading", { name: "任务已取消" })).toBeVisible();
});
