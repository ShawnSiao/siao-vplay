import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("global activity retains another video's failed summary and opens its project", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const fixture = window as unknown as { summaryFixtureStatus: string; __TAURI_INTERNALS__: unknown };
    fixture.summaryFixtureStatus = "running";
    fixture.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command !== "list_summary_activity") throw new Error(`Unexpected fixture IPC: ${command}`);
      return [{ id: "summary-a", projectId: "project-a", projectTitle: "视频 A", status: fixture.summaryFixtureStatus, hasResult: false, updatedAtMs: 1 }];
    } };
  });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/library.html?activity=1");
  await page.getByRole("button", { name: "处理动态", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /视频 A 正在总结/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "处理动态", exact: true })).toBeFocused();
  await page.evaluate(() => { (window as unknown as { summaryFixtureStatus: string }).summaryFixtureStatus = "failed"; });
  await expect(page.getByText("「视频 A」的总结需要处理", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭通知" }).click();
  await page.getByRole("button", { name: "处理动态", exact: true }).click();
  const result = page.getByRole("menuitem", { name: /视频 A 处理失败，可重试/ });
  await expect(result).toBeVisible();
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "summary-activity-960.png"), fullPage: true });
  await result.click();
  await expect(page.getByText("已选择视频：视频 A")).toBeVisible();
  expect(errors).toEqual([]);
});
