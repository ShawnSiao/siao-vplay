import { expect, test } from "@playwright/test";
test("invalid cleanup plan stays out of the confirmation flow", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as { cleanupCalls: number; __TAURI_INTERNALS__: unknown }; state.cleanupCalls = 0;
    state.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => undefined, invoke: async (command: string) => {
      if (command.startsWith("plugin:event|")) return 1;
      if (command === "get_local_resource_catalog") return { schemaVersion: 1, productId: "siaovplay", updatedAt: "", packageProfile: "app-only", bundlePolicy: { maximumExceptionBytes: 0, allowlistedResourceIds: [] }, capabilities: [], profiles: [], resources: [] };
      if (command === "get_local_resource_status") return { snapshotRevision: 1, configured: true, selectedParent: "W:\\fixture", resourceRoot: "W:\\fixture\\resources", rootState: "ready", freeSpaceBytes: 1024, preferredProfile: "standard", capabilities: [] };
      if (command === "get_local_resource_network_status") return { snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null };
      if (command === "list_resource_download_tasks") return { generation: 1, tasks: [] };
      if (command === "get_local_resource_diagnostics") return { generatedAtMs: 1, catalogSource: "embedded", remoteCatalogEnabled: false, remoteSignaturePolicy: "disabled", rootState: "ready", resourceRoot: "W:\\fixture\\resources", preferredProfile: "standard", resources: [], tasks: [] };
      if (command === "get_local_resource_third_party_notices") return "fixture";
      if (command === "plan_old_resource_version_cleanup") return { candidates: [{ resourceId: "ffmpeg", version: "1", reclaimableBytes: 12 }], protectedVersions: ["ffmpeg@1"], reclaimableBytes: 12, confirmationRequired: true };
      if (command === "cleanup_old_resource_versions") { state.cleanupCalls++; throw new Error("must not execute"); }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  });
  await page.goto("/e2e/runtime.html?live=1");
  const maintenance = page.locator("details.local-resources-maintenance");
  await expect(maintenance).toBeVisible();
  if (await maintenance.getAttribute("open") === null) await maintenance.locator("summary").click();
  await page.getByRole("button", { name: "清理旧版本", exact: true }).click();
  await expect(page.getByText("资源维护结果无效或与当前操作不匹配，请刷新资源状态后检查。", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^清理旧版本 / })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { cleanupCalls: number }).cleanupCalls)).toBe(0);
  expect(errors).toEqual([]);
});
