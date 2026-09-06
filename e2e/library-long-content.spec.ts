import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const width of [480, 960, 1440]) {
  test(`twenty long media titles preserve actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 480 ? 320 : 720 });
    await page.goto("/e2e/library.html?long-list=1");
    const items = page.locator(".library-media-item");
    await expect(items).toHaveCount(20);
    const scroller = page.locator(".library-scroll");
    expect(await scroller.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    for (const item of [items.first(), items.last()]) {
      const action = item.getByRole("button", { name: "继续", exact: true });
      await action.focus();
      await expect(action).toBeInViewport();
      const box = await action.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await item.getByRole("button", { name: /的更多操作$/ }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(item.getByRole("button", { name: /的更多操作$/ })).toBeFocused();
    }
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `library-long-${width}.png`) });
  });
}
