import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 960, height: 720 }, { width: 820, height: 720 }, { width: 480, height: 720 }, { width: 960, height: 440 }]) {
  test(`drawer layout remains bounded at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/e2e/player.html");
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: /^剧集/ }).click();
    const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
    await expect(drawer).toBeVisible();
    const layout = await drawer.evaluate(node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return { width: style.width, bottom: style.bottom, position: style.position, left: rect.left, right: rect.right, top: rect.top, height: rect.height };
    });
    console.info(JSON.stringify({ viewport, layout }));
    expect(layout.width).toBe(viewport.width >= 1280 ? "340px" : viewport.width <= 820 ? `${viewport.width}px` : "320px");
    expect(layout.bottom).toBe(viewport.height <= 480 ? "0px" : viewport.width >= 1280 ? "auto" : "64px");
    expect(layout.position).toBe(viewport.width >= 1280 ? "static" : "absolute");
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(viewport.width);
    expect(layout.height).toBeGreaterThan(100);
    expect(errors).toEqual([]);
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `drawer-${viewport.width}x${viewport.height}.png`) });
  });
}
