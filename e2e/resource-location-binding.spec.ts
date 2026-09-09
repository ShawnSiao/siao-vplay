import { expect, test } from "@playwright/test";
for (const mode of ["stale", "binding", "startup"] as const) test(`location recovery: ${mode}`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript((mode) => {
    let configured = mode === "startup", ready = false;
    const status = () => ({ snapshotRevision: configured ? 2 : 1, configured, selectedParent: configured ? "W:/selected" : null, resourceRoot: configured ? "W:/selected/SiaoVPlay" : null, rootState: configured ? "ready" : "setup_required", freeSpaceBytes: null, preferredProfile: "standard", capabilities: [] });
    const result = () => ({ ...status(), configurationFingerprint: "b".repeat(64), bindingError: ready ? null : "任务文件暂时无法读取", taskSnapshot: ready ? { generation: 2, tasks: [] } : null });
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; locationArgs?: unknown; writes: number; retries: number; retryArgs?: unknown };
    state.writes = 0; state.retries = 0;
    state.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => undefined,
      invoke: async (command: string, args?: unknown) => {
        if (command.startsWith("plugin:event|")) return 1;
        if (command === "plugin:dialog|open") return "W:/selected";
        if (command === "get_local_resource_catalog") return { schemaVersion: 1, productId: "siaovplay", updatedAt: "", packageProfile: "app-only", bundlePolicy: { maximumExceptionBytes: 0, allowlistedResourceIds: [] }, capabilities: [], profiles: [{ id: "standard", title: "标准", resourceIds: [], recommended: true }], resources: [] };
        if (command === "get_local_resource_status") return status();
        if (command === "get_local_resource_network_status") return { snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null };
        if (command === "list_resource_download_tasks") { if (configured && !ready) throw { code: "local_resource_binding_unavailable", message: "任务状态无法读取" }; return { generation: ready ? 2 : 1, tasks: [] }; }
        if (command === "get_local_resource_diagnostics") return { generatedAtMs: 1, catalogSource: "embedded", remoteCatalogEnabled: false, maintenance: { transactionState: "none", scanState: "complete", stagingReviewCount: 0, receiptRecoveryCopyCount: 0 }, remoteSignaturePolicy: "disabled", rootState: "ready", resourceRoot: "W:/old/SiaoVPlay", preferredProfile: "standard", resources: [], tasks: [] };
        if (command === "get_local_resource_third_party_notices") return "fixture";
        if (command === "plan_local_resource_location") return { selectedParent: "W:/selected", resourceRoot: "W:/selected/SiaoVPlay", planFingerprint: "a".repeat(64), parentExists: true, resourceRootExists: false, freeSpaceBytes: null, confirmationRequired: true };
        if (command === "configure_local_resource_root") {
          state.writes++; state.locationArgs = args;
          if (mode === "stale") throw new Error("保存位置计划已变化，请重新选择并核对保存位置");
          configured = true; return result();
        }
        if (command === "inspect_local_resource_binding") return result();
        if (command === "retry_local_resource_binding") { state.retries++; state.retryArgs = args; ready = true; return result(); }
        throw new Error(`Unexpected IPC: ${command}`);
      } };
  }, mode);
  await page.goto(`/e2e/runtime.html?live=1${mode === "startup" ? "" : "&firstRun=1"}`);
  const choose = page.getByRole("button", { name: "选择保存位置", exact: true });
  const confirm = page.getByRole("button", { name: "保存位置并进入", exact: true });
  if (mode !== "startup") {
    await expect(confirm).toBeDisabled(); await choose.click();
    await expect(page.getByText("W:/selected/SiaoVPlay", { exact: true })).toBeVisible();
    await expect(confirm).toBeEnabled(); await confirm.click();
    if (mode === "stale") await expect(confirm).toBeDisabled();
    else { await expect(page.getByText("保存位置已保留，任务状态尚未恢复", { exact: true })).toBeVisible(); await expect(confirm).toHaveCount(0); }
    expect(await page.evaluate(() => (window as unknown as { locationArgs: unknown }).locationArgs)).toEqual({ input: { parentPath: "W:/selected", resourceRoot: "W:/selected/SiaoVPlay", planFingerprint: "a".repeat(64), confirmed: true } });
  }
  if (mode === "stale") {
    await expect(page.getByText("保存位置计划已变化，请重新选择并核对保存位置", { exact: true })).toBeVisible();
    await page.screenshot({ path: "designs/open-source-readiness/location-confirmation-retry.png" });
    await choose.click(); await expect(confirm).toBeEnabled();
  } else {
    await expect(page.getByText("保存位置已保留，任务状态尚未恢复", { exact: true })).toBeVisible();
    const retry = page.getByRole("button", { name: "恢复任务状态", exact: true });
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `designs/open-source-readiness/location-recovery-${mode}.png` });
    await retry.click();
    await expect(retry).toHaveCount(0);
    const state = await page.evaluate(() => { const value = window as unknown as { writes: number; retries: number; retryArgs: unknown }; return { writes: value.writes, retries: value.retries, retryArgs: value.retryArgs }; });
    expect(state.writes).toBe(mode === "startup" ? 0 : 1); expect(state.retries).toBe(1);
    expect(state.retryArgs).toEqual({ input: { resourceRoot: "W:/selected/SiaoVPlay", configurationFingerprint: "b".repeat(64) } });
  }
  expect(errors).toEqual([]);
});
