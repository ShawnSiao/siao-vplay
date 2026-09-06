import { expect, test } from "@playwright/test";
import { join } from "node:path";

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

for (const width of [960, 1440]) {
  test(`summary body and source evidence remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/e2e/player.html?summary=result&drawer");
    const body = page.locator(".summary-overview-copy p").first();
    await expect(body).toBeVisible();
    expect(await body.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    await page.locator(".summary-evidence-details summary").first().click();
    const evidence = page.locator(".summary-evidence p").first();
    await expect(evidence).toBeVisible();
    expect(await evidence.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `summary-reading-${width}.png`) });
    const citation = page.locator(".summary-citation").first();
    expect(await citation.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
    await page.getByRole("button", { name: "展开阅读", exact: true }).click();
    expect(await body.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    await page.getByText("阅读设置", { exact: true }).click();
    const normalLeading = await body.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
    await page.getByRole("button", { name: "紧凑", exact: true }).click();
    expect(await body.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight))).toBeLessThan(normalLeading);
    const panel = page.locator(".video-summary-panel");
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  });
}
