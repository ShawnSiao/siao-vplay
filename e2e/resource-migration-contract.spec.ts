import { expect, test } from "@playwright/test";
for (const kind of ["move", "adopt"] as const) test(`invalid ${kind} preview cannot be confirmed and can be inspected again`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(kind => {
    let reads = 0;
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; migrationWrites: number; moveArgs?: unknown }; state.migrationWrites = 0;
    state.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => undefined,
      invoke: async (command: string, args?: unknown) => {
        if (command.startsWith("plugin:event|")) return 1;
        if (command === "plugin:dialog|open") return "W:/selected";
        if (command === "get_local_resource_catalog") return { schemaVersion: 1, productId: "siaovplay", updatedAt: "", packageProfile: "app-only", bundlePolicy: { maximumExceptionBytes: 0, allowlistedResourceIds: [] }, capabilities: [], profiles: [{ id: "standard", title: "标准", resourceIds: [], recommended: true }], resources: [] };
        if (command === "get_local_resource_status") return { snapshotRevision: 1, configured: true, selectedParent: "W:/old", resourceRoot: "W:/old/SiaoVPlay", rootState: "ready", freeSpaceBytes: 1024, preferredProfile: "standard", capabilities: [] };
        if (command === "get_local_resource_network_status") return { snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null };
        if (command === "list_resource_download_tasks") return { generation: 1, tasks: [] };
        if (command === "get_local_resource_diagnostics") return { generatedAtMs: 1, catalogSource: "embedded", remoteCatalogEnabled: false, maintenance: { transactionState: "none", scanState: "complete", stagingReviewCount: 0, receiptRecoveryCopyCount: 0 }, remoteSignaturePolicy: "disabled", rootState: "ready", resourceRoot: "W:/old/SiaoVPlay", preferredProfile: "standard", resources: [], tasks: [] };
        if (command === "get_local_resource_third_party_notices") return "fixture";
        if (command === "plan_local_resource_move") return { planFingerprint: "a".repeat(64), previousRoot: "W:/old/SiaoVPlay", selectedParent: "W:/selected", resourceRoot: "W:/selected/SiaoVPlay", bytesToCopy: ++reads === 1 ? -1 : 10, fileCount: 1, freeSpaceBytes: null, crossVolume: false, destinationExists: false, confirmationRequired: true };
        if (command === "inspect_local_resource_migration") return { sources: [{ kind: "selected_directory", path: "W:/selected" }], candidates: [{ sourceKind: "selected_directory", sourceRoot: "W:/selected", resourceId: "tool", resourcePath: "W:/selected/tool", state: "verified", reusableBytes: 10, message: null }], verifiedResourceIds: ["tool"], reusableBytes: ++reads === 1 ? 11 : 10, rejectedCount: 0 };
        if (command === "move_local_resource_root") { state.migrationWrites++; state.moveArgs = args; throw new Error("资源移动计划已变化，请重新检查保存位置并确认"); }
        if (command === "adopt_local_resources") { state.migrationWrites++; throw new Error(`Unexpected write: ${kind}`); }
        throw new Error(`Unexpected IPC: ${command}`);
      } };
  }, kind);
  await page.goto("/e2e/runtime.html?live=1");
  const advanced = page.getByText("高级维护：存储位置、迁移、修复和清理", { exact: true });
  await expect(advanced).toBeVisible();
  if (await advanced.locator("..").getAttribute("open") === null) await advanced.click();
  const inspect = page.getByRole("button", { name: kind === "move" ? "移动保存位置" : "选择现有资源目录", exact: true });
  const confirm = page.getByRole("button", { name: kind === "move" ? "确认复制并切换" : "接管已验证资源", exact: true });
  await inspect.click();
  await expect(page.getByText("资源迁移结果无效，请重新检查资源状态和所选目录。", { exact: true })).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await inspect.click(); await expect(confirm).toBeEnabled();
  await expect(page.getByText("资源迁移结果无效，请重新检查资源状态和所选目录。", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { migrationWrites: number }).migrationWrites)).toBe(0);
  if (kind === "move") {
    await confirm.click();
    await expect(page.getByText("资源移动计划已变化，请重新检查保存位置并确认", { exact: true })).toBeVisible();
    await expect(confirm).toHaveCount(0);
    const args = await page.evaluate(() => (window as unknown as { moveArgs: { input: unknown; requestId: string } }).moveArgs);
    expect(args.input).toEqual({ parentPath: "W:/selected", confirmed: true, planFingerprint: "a".repeat(64) });
    expect(args.requestId).toMatch(/^[a-f0-9-]{36}$/);
    await inspect.click(); await expect(confirm).toBeEnabled();
  }
  expect(errors).toEqual([]);
});
