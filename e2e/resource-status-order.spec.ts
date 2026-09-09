import { expect, test } from "@playwright/test";
import { createResourceTaskFixture } from "../src/test-fixtures/resourceTask";
test("late status from the first completion cannot undo a newer ready capability", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const task = { ...createResourceTaskFixture(), resourceId: "ffmpeg-cpu", requestedByCapabilityIds: ["basic_media"], state: "downloading" as const };
  await page.addInitScript(task => {
    const state = window as unknown as { __TAURI_INTERNALS__: unknown; __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
      reads: number; finishStale: () => void; emitComplete: (other: boolean) => void };
    const callbacks = new Map<number, (event: unknown) => void>(); const active = new Set<number>(); let callbackId = 0;
    state.reads = 0;
    const status = (snapshotRevision: number, ready: boolean) => ({ snapshotRevision, configured: true, selectedParent: null, resourceRoot: null,
      rootState: "ready", freeSpaceBytes: null, preferredProfile: "standard", capabilities: [{ id: "basic_media", title: "基础视频支持",
        state: ready ? "ready" : "not_ready", requiredResourceIds: ["ffmpeg-cpu"], missingResourceIds: ready ? [] : ["ffmpeg-cpu"] }] });
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => { active.delete(id); } };
    state.emitComplete = other => { for (const id of active) callbacks.get(id)?.({ payload: { ...task, id: other ? "other" : task.id, state: "completed", revision: 2 } }); };
    state.__TAURI_INTERNALS__ = {
      transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++callbackId, callback); return callbackId; },
      invoke: async (command: string, args: { handler?: number; eventId?: number }) => {
        if (command === "plugin:event|listen") { active.add(args.handler!); return args.handler; }
        if (command === "plugin:event|unlisten") return;
        if (command === "get_local_resource_catalog") return { schemaVersion: 1, productId: "siaovplay", updatedAt: "2026-09-09", packageProfile: "app-only",
          bundlePolicy: { maximumExceptionBytes: 20000000, allowlistedResourceIds: [] }, profiles: [{ id: "standard", title: "标准", resourceIds: [], recommended: true }], resources: [{ id: "ffmpeg-cpu", version: "1", platform: "windows-x86_64", kind: "archive", bundled: false, installedSize: 12, expectedDownloadSize: 10, sourceCommit: null, patchSha256: null, requires: null, distribution: { status: "pending_release_asset" }, license: "test", sourcePage: "https://example.test", artifact: null, entrypoints: {}, healthCheck: "version" }],
          capabilities: [{ id: "basic_media", title: "基础视频支持", resourceIds: ["ffmpeg-cpu"], profileIds: [], requiresCapabilityIds: [] }] };
        if (command === "get_local_resource_status") {
          const revision = ++state.reads;
          if (revision === 2) return new Promise(resolve => { state.finishStale = () => resolve(status(2, false)); });
          return status(revision, revision >= 3);
        }
        if (command === "get_local_resource_network_status") return { snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null };
        if (command === "list_resource_download_tasks") return { generation: 1, tasks: [task, { ...task, id: "other" }] };
        throw new Error(`Unexpected fixture IPC: ${command}`);
      },
    };
  }, task);
  await page.clock.install(); await page.goto("/e2e/runtime.html?live=1");
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toHaveCount(2);
  await page.evaluate(() => (window as unknown as { emitComplete: (other: boolean) => void }).emitComplete(false));
  await expect.poll(() => page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(2);
  await page.evaluate(() => (window as unknown as { emitComplete: (other: boolean) => void }).emitComplete(true));
  const capability = page.getByRole("region", { name: "需要的功能" });
  await expect(capability.getByText("已准备", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishStale: () => void }).finishStale());
  await expect(capability.getByText("已准备", { exact: true })).toBeVisible();
  await expect(capability.getByText("暂不可用", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
