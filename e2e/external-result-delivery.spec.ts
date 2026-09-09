import { expect, test } from "@playwright/test";

test("App acknowledges an external completion only after delivery and retries a failed acknowledgement", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; acknowledgements: number; delivered: boolean };
    state.acknowledgements = 0;
    state.delivered = false;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args?: { updates?: unknown[] }) => {
      if (command === "get_app_status") return { appName: "SiaoVPlay", version: "0.4.1", platform: "windows-desktop", dataDirectory: "W:/isolated", startupMediaPath: null };
      if (command === "reconcile_external_agent_results") return state.delivered ? [] : [{
        taskKind: "translation", taskId: "task", projectId: "other-project", status: "completed", outputId: "version", message: "已导入",
      }];
      if (command === "acknowledge_external_agent_results") {
        state.acknowledgements++;
        if (state.acknowledgements === 1) throw new Error("isolated acknowledgement transport failure");
        if (JSON.stringify(args?.updates) !== JSON.stringify([{ taskKind: "translation", taskId: "task", projectId: "other-project", status: "completed", outputId: "version", message: "已导入" }])) throw new Error("wrong receipt");
        state.delivered = true;
        return null;
      }
      throw new Error("测试环境未提供此服务");
    } };
  });
  await page.goto("/");
  await expect(page.getByText("后台结果已准备好", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { delivered: boolean }).delivered)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { acknowledgements: number }).acknowledgements)).toBe(2);
});


test("a failed receipt does not block a new completion from a later scan", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; goodAcknowledged: boolean; badAttempts: number; scans: number };
    state.goodAcknowledged = false;
    state.badAttempts = 0; state.scans = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args?: { updates?: { taskId: string }[] }) => {
      if (command === "reconcile_external_agent_results") {
        state.scans++;
        return (state.scans === 1 || state.goodAcknowledged ? ["bad"] : ["bad", "good"]).map(taskId => ({
          taskKind: "translation", taskId, projectId: "other-project", status: "completed", outputId: taskId, message: "已导入",
        }));
      }
      if (command === "acknowledge_external_agent_results") {
        if (args?.updates?.some(update => update.taskId === "bad")) {
          state.badAttempts++;
          throw new Error("persistent isolated acknowledgement failure");
        }
        state.goodAcknowledged = args?.updates?.[0]?.taskId === "good";
        return null;
      }
      throw new Error("测试环境未提供此服务");
    } };
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as unknown as { goodAcknowledged: boolean }).goodAcknowledged)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { badAttempts: number; scans: number }).badAttempts)).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("后台结果已准备好", { exact: true })).toBeVisible();
});


test("invalid notification does not reach acknowledgement or block a valid result", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; goodAcknowledged: boolean; invalidAcknowledgements: number; scans: number };
    state.goodAcknowledged = false; state.invalidAcknowledgements = 0; state.scans = 0;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args?: { updates?: { taskId: string }[] }) => {
      if (command === "reconcile_external_agent_results") {
        state.scans++;
        const good = { taskKind: "translation", taskId: "good", projectId: "other-project", status: "completed", outputId: "version", message: "已导入" };
        return [{ ...good, taskId: "invalid", outputId: null }, ...(state.goodAcknowledged ? [] : [good])];
      }
      if (command === "acknowledge_external_agent_results") {
        if (args?.updates?.some(update => update.taskId === "invalid")) state.invalidAcknowledgements++;
        state.goodAcknowledged = args?.updates?.some(update => update.taskId === "good") ?? false;
        return null;
      }
      throw new Error("测试环境未提供此服务");
    } };
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as unknown as { goodAcknowledged: boolean }).goodAcknowledged)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { scans: number }).scans)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => (window as unknown as { invalidAcknowledgements: number }).invalidAcknowledgements)).toBe(0);
  await expect(page.getByText("后台结果已准备好", { exact: true })).toBeVisible();
});
