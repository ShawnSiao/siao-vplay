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
