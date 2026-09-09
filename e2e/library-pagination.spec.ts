import { expect, test } from "@playwright/test";
import { join } from "node:path";
for (const width of [480, 960]) {
  test(`library collection retries preserve rows and fit ${width}px`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/e2e/library.html?collection-pages=1");
    const rows = page.locator(".library-episodes .library-media-item");
    await expect(rows).toHaveCount(1);
    const load = page.getByRole("button", { name: "加载更多剧集" });
    await load.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("后续剧集读取失败");
    await expect(rows).toHaveCount(1);
    const retry = page.getByRole("button", { name: "重试加载更多" });
    await retry.focus(); await expect(retry).toBeInViewport();
    const scroller = page.locator(".library-scroll");
    expect(await scroller.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `library-pagination-error-${width}.png`) });
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole("status").filter({ hasText: "已显示 2 / 2 集" })).toBeVisible();
    await expect(load).toHaveCount(0);
    await page.goto("/e2e/library.html?collection-pages=failed");
    await expect(page.getByText("合集还是空的")).toHaveCount(0);
    await page.getByRole("button", { name: "重新加载剧集" }).click();
    await expect(rows).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
