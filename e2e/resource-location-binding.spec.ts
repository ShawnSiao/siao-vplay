import { expect, test } from "@playwright/test";
test("first location confirmation is consumed after stale-plan rejection", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; locationArgs?: unknown; writes: number };
    state.writes = 0;
    state.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => undefined,
      invoke: async (command: string, args?: unknown) => {
        if (command.startsWith("plugin:event|")) return 1;
        if (command === "plugin:dialog|open") return "W:/selected";
        if (command === "get_local_resource_catalog") return { schemaVersion: 1, productId: "siaovplay", updatedAt: "", packageProfile: "app-only", bundlePolicy: { maximumExceptionBytes: 0, allowlistedResourceIds: [] }, capabilities: [], profiles: [{ id: "standard", title: "标准", resourceIds: [], recommended: true }], resources: [] };
        if (command === "get_local_resource_status") return { snapshotRevision: 1, configured: false, selectedParent: null, resourceRoot: null, rootState: "setup_required", freeSpaceBytes: 1024, preferredProfile: "standard", capabilities: [] };
        if (command === "get_local_resource_network_status") return { snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null };
        if (command === "list_resource_download_tasks") return { generation: 1, tasks: [] };
        if (command === "get_local_resource_diagnostics") return { generatedAtMs: 1, catalogSource: "embedded", remoteCatalogEnabled: false, maintenance: { transactionState: "none", scanState: "complete", stagingReviewCount: 0, receiptRecoveryCopyCount: 0 }, remoteSignaturePolicy: "disabled", rootState: "ready", resourceRoot: "W:/old/SiaoVPlay", preferredProfile: "standard", resources: [], tasks: [] };
        if (command === "get_local_resource_third_party_notices") return "fixture";
        if (command === "plan_local_resource_location") return { selectedParent: "W:/selected", resourceRoot: "W:/selected/SiaoVPlay", planFingerprint: "a".repeat(64), parentExists: true, resourceRootExists: false, freeSpaceBytes: null, confirmationRequired: true };
        if (command === "configure_local_resource_root") {
          state.writes++; state.locationArgs = args;
          throw new Error("保存位置计划已变化，请重新选择并核对保存位置");
        }
        throw new Error(`Unexpected IPC: ${command}`);
      } };
  });
  await page.goto("/e2e/runtime.html?live=1&firstRun=1");
  const choose = page.getByRole("button", { name: "选择保存位置", exact: true });
  const confirm = page.getByRole("button", { name: "保存位置并进入", exact: true });
  await expect(confirm).toBeDisabled(); await choose.click();
  await expect(page.getByText("W:/selected/SiaoVPlay", { exact: true })).toBeVisible();
  await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(page.getByText("保存位置计划已变化，请重新选择并核对保存位置", { exact: true })).toBeVisible();
  await expect(confirm).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { locationArgs: unknown }).locationArgs)).toEqual({ input: { parentPath: "W:/selected", resourceRoot: "W:/selected/SiaoVPlay", planFingerprint: "a".repeat(64), confirmed: true } });
  await page.screenshot({ path: "designs/open-source-readiness/location-confirmation-retry.png" });
  await choose.click(); await expect(confirm).toBeEnabled();
  expect(errors).toEqual([]);
});
