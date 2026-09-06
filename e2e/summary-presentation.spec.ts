import { expect, test } from "@playwright/test";

test("summary progress and relationships use readable content", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?summary=progress");
  await expect(page.getByText("已完成 3 / 7 段")).toBeVisible();
  await expect(page.getByText("analyzing_chunks", { exact: true })).toHaveCount(0);
  await expect(page.getByText("38% · 正在分析字幕片段", { exact: true })).toBeVisible();
  await page.goto("/e2e/player.html?summary=result");
  await page.getByRole("heading", { name: "关系说明" }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Input → State", { exact: true })).toBeVisible();
  await expect(page.locator(".summary-mermaid pre")).toHaveCount(0);
  expect(errors).toEqual([]);
});
