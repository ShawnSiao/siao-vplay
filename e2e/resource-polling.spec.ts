import { expect, test } from "@playwright/test";
import { createResourceTaskFixture } from "../src/test-fixtures/resourceTask";

for (const multiple of [false, true]) test(`resource polling preserves a pause with ${multiple ? "another active task" : "one task"}`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const task = { ...createResourceTaskFixture(), state: "downloading" as const };
  await page.addInitScript(({ task, multiple }) => {
    const tasks = multiple ? [task, { ...task, id: "other-task", createdAtMs: 0 }] : [task];
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; __TAURI_EVENT_PLUGIN_INTERNALS__: unknown; reads: number; finish: () => void };
    state.reads = 0;
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    state.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string) => {
      if (command === "plugin:event|listen" || command === "plugin:event|unlisten") return 1;
      if (command === "get_local_resource_catalog") return { schemaVersion: 1, productId: "siaovplay", updatedAt: "2026-09-09", packageProfile: "app-only",
        bundlePolicy: { maximumExceptionBytes: 20000000, allowlistedResourceIds: [] }, capabilities: [], profiles: [], resources: [] };
      if (command === "get_local_resource_status") return { configured: true, selectedParent: null, resourceRoot: null, rootState: "ready",
        freeSpaceBytes: null, preferredProfile: "standard", capabilities: [] };
      if (command === "get_local_resource_network_status") return { mode: "direct", proxySource: "direct", proxyAddress: null };
      if (command === "list_resource_download_tasks") {
        if (++state.reads === 1) return { generation: 1, tasks };
        return new Promise(resolve => { state.finish = () => resolve({ generation: 1, tasks }); });
      }
      if (command === "pause_resource_download") return { ...task, state: "paused", revision: 2 };
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, { task, multiple });
  await page.clock.install(); await page.goto("/e2e/runtime.html?live=1");
  await expect(page.getByRole("button", { name: "暂停", exact: true }).first()).toBeVisible();
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(2);
  await page.getByRole("button", { name: "暂停", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "继续", exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  await page.clock.runFor(3000);
  await expect(page.getByRole("button", { name: "继续", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toHaveCount(multiple ? 1 : 0);
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(multiple ? 3 : 2);
  expect(errors).toEqual([]);
});
