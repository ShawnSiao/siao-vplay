import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("cleanup recovery survives reload and retains retry after an occupied file", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke: async (command: string, args?: { projectId?: string }) => {
      const attempts = Number(sessionStorage.getItem("cleanup-attempts") ?? 0);
      if (command === "get_pending_project_cleanup") return attempts >= 2 ? null : { projectId: "deleted-project", pendingDirectories: 1 };
      if (command === "delete_project" && args?.projectId === "deleted-project") {
        sessionStorage.setItem("cleanup-attempts", String(attempts + 1));
        return { projectId: "deleted-project", deleted: false, sourceMediaDeleted: false, cachedMediaDeleted: false, cleanupPending: attempts === 0 ? 1 : 0 };
      }
      throw new Error(`Unexpected fixture IPC: ${command}`);
    } };
  });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/library.html?cleanup=1");
  const retry = page.getByRole("button", { name: "重试清理" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByText(/仍有文件未清理/)).toBeVisible();
  await expect(retry).toBeEnabled();
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "cleanup-retry-960.png"), fullPage: true });
  await page.reload();
  await expect(retry).toBeVisible();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(retry).toHaveCount(0);
  await page.reload();
  await expect(retry).toHaveCount(0);
  expect(errors).toEqual([]);
});
