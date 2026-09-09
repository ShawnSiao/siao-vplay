import { expect, test } from "@playwright/test";
for (const mode of ["invalid", "stale", "refresh-failure", "partial", "partial-refresh", "unrelated-result", "pending-diagnostic", "partial-diagnostic", "unreadable-diagnostic", "unverified-diagnostic"] as const) test(`cleanup confirmation and result feedback: ${mode}`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript((mode) => {
    const state = window as unknown as { cleanupCalls: number; fingerprint?: string; __TAURI_INTERNALS__: unknown }; state.cleanupCalls = 0;
    const resource = { id: "ffmpeg", version: "1", platform: "windows-x86_64", kind: "archive", bundled: false,
      installedSize: 12, license: "test", sourcePage: "https://example.test", artifact: null, entrypoints: {}, healthCheck: "version" };
    const diagnosticResource = { id: "ffmpeg", catalogVersion: "1", activeVersion: "1", state: "repair_required", license: "test",
      sourcePage: "https://example.test", artifactSha256: null, artifactUrl: null, healthCheck: "version", versionsReadable: mode !== "unreadable-diagnostic", unverifiedReceiptCount: mode === "unverified-diagnostic" ? 3 : 0, versions: [] };
    state.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => undefined, invoke: async (command: string, args?: { input?: { planFingerprint?: string } }) => {
      if (command.startsWith("plugin:event|")) return 1;
      if (command === "get_local_resource_catalog") return { schemaVersion: 1, productId: "siaovplay", updatedAt: "", packageProfile: "app-only", bundlePolicy: { maximumExceptionBytes: 0, allowlistedResourceIds: [] }, capabilities: [], profiles: [], resources: (mode === "unreadable-diagnostic" || mode === "unverified-diagnostic") ? [resource] : [] };
      if (command === "get_local_resource_status" && (mode === "refresh-failure" || mode === "partial-refresh") && state.cleanupCalls > 0) throw new Error("status unavailable");
      if (command === "get_local_resource_status") return { snapshotRevision: 1, configured: true, selectedParent: "W:\\fixture", resourceRoot: "W:\\fixture\\resources", rootState: "ready", freeSpaceBytes: 1024, preferredProfile: "standard", capabilities: [] };
      if (command === "get_local_resource_network_status") return { snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null };
      if (command === "list_resource_download_tasks") return { generation: 1, tasks: [] };
      if (command === "get_local_resource_diagnostics") return { generatedAtMs: 1, catalogSource: "embedded", remoteCatalogEnabled: false, maintenance: { transactionState: mode === "pending-diagnostic" ? "activation_pending" : "none", scanState: mode === "partial-diagnostic" ? "partial" : "complete", stagingReviewCount: mode === "pending-diagnostic" ? 2 : 0, receiptRecoveryCopyCount: mode === "pending-diagnostic" ? 1 : 0 }, remoteSignaturePolicy: "disabled", rootState: "ready", resourceRoot: "W:\\fixture\\resources", preferredProfile: "standard", resources: (mode === "unreadable-diagnostic" || mode === "unverified-diagnostic") ? [diagnosticResource] : [], tasks: [] };
      if (command === "get_local_resource_third_party_notices") return "fixture";
      if (command === "plan_old_resource_version_cleanup" && (mode === "partial" || mode === "partial-refresh")) return { planFingerprint: "a".repeat(64), candidates: ["0", "1", "2"].map(version => ({ resourceId: "ffmpeg", version, reclaimableBytes: 12 })), protectedVersions: ["ffmpeg@3"], reclaimableBytes: 36, confirmationRequired: true };
      if (command === "plan_old_resource_version_cleanup") return { planFingerprint: "a".repeat(64), candidates: [{ resourceId: "ffmpeg", version: "1", reclaimableBytes: 12 }], protectedVersions: mode !== "invalid" ? ["ffmpeg@2"] : ["ffmpeg@1"], reclaimableBytes: 12, confirmationRequired: true };
      if (command === "cleanup_old_resource_versions") { state.cleanupCalls++; state.fingerprint = args?.input?.planFingerprint;
        if (mode === "partial" || mode === "partial-refresh") return { removedVersions: ["ffmpeg@0"], reclaimedBytes: 12, interruption: { itemId: "ffmpeg@1", message: "文件被占用。", remainingItemIds: ["ffmpeg@1", "ffmpeg@2"] } };
        if (mode === "unrelated-result") return { removedVersions: ["other@1"], reclaimedBytes: 12, interruption: null };
        if (mode === "refresh-failure") return { removedVersions: ["ffmpeg@1"], interruption: null, reclaimedBytes: 12 }; throw new Error("资源清理计划已变化，请重新检查清理清单并确认"); }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  }, mode);
  await page.goto("/e2e/runtime.html?live=1");
  const maintenance = page.locator("details.local-resources-maintenance");
  await expect(maintenance).toBeVisible();
  if (await maintenance.getAttribute("open") === null) await maintenance.locator("summary").click();
  if (mode === "pending-diagnostic" || mode === "partial-diagnostic" || mode === "unreadable-diagnostic" || mode === "unverified-diagnostic") {
    const advanced = page.getByText("高级诊断与第三方许可", { exact: true });
    if (await advanced.locator("..").getAttribute("open") === null) await advanced.click();
    const notice = page.getByRole("region", { name: "资源变更与备份检查" });
    await expect(notice).toBeVisible();
    if (mode === "unverified-diagnostic") {
      const warning = page.getByText("发现 3 项无法验证的安装记录；未将其载入版本列表，现有文件已保留。请核对应用版本或联系维护者。", { exact: true });
      await expect(warning).toBeVisible();
      await warning.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "designs/open-source-readiness/resource-unverified-receipts.png" });
    } else if (mode === "unreadable-diagnostic") {
      const warning = page.getByText("版本检查未完成，安装记录或资源目录无法读取。已保留文件，请检查目录访问权限后重试。", { exact: true });
      await expect(warning).toBeVisible();
      await warning.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "designs/open-source-readiness/resource-unreadable-diagnostics.png" });
    } else await expect(notice).toContainText(mode === "pending-diagnostic" ? "尚未确认归属" : "数量仅为已检查部分");
    await expect(notice.getByRole("button")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { cleanupCalls: number }).cleanupCalls)).toBe(0);
    if (mode === "pending-diagnostic") {
      await notice.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "designs/open-source-readiness/resource-pending-diagnostics.png" });
    }
    expect(errors).toEqual([]);
    return;
  }
  await page.getByRole("button", { name: "清理旧版本", exact: true }).click();
  if (mode !== "invalid") {
    await page.getByRole("button", { name: /^清理旧版本 / }).click();
    const message = mode === "stale" ? "资源清理计划已变化，请重新检查清理清单并确认" :
      mode === "partial" || mode === "partial-refresh" ? "清理中断：已完成 1 项，2 项尚未确认完成。文件被占用。 请重新检查清单后再继续。" :
      mode === "unrelated-result" ? "清理结果与确认清单不匹配，请重新检查资源状态。" : "清理结果已保留，资源状态刷新失败：status unavailable";
    await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { fingerprint: string }).fingerprint)).toBe("a".repeat(64));
    await expect(page.getByRole("button", { name: /^清理旧版本 / })).toHaveCount(0);
  } else {
    await expect(page.getByText("资源维护结果无效或与当前操作不匹配，请刷新资源状态后检查。", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^清理旧版本 / })).toHaveCount(0);
  }
  expect(await page.evaluate(() => (window as unknown as { cleanupCalls: number }).cleanupCalls)).toBe(mode === "invalid" ? 0 : 1);
  expect(errors).toEqual([]);
});
