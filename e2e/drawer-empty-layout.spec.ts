import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const width of [1440, 960]) {
  for (const state of ["single", "loading", "error"]) {
    test(`drawer ${state} layout at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 960 ? 640 : 900 });
      await page.goto(`/e2e/player.html?episodeState=${state}`);
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("menuitem", { name: /^剧集/ }).click();
      const content = page.locator(".player-drawer-empty");
      await expect(content).toBeVisible();
      await expect(content.locator("strong")).toBeInViewport();
      await expect(content).toHaveCSS("display", "grid");
      await expect(content).toHaveCSS("min-height", "280px");
      await expect(content).toHaveCSS("padding", "32px 24px");
      await expect(content).toHaveCSS("text-align", "center");
      await expect(content.locator("strong")).toHaveCSS("font-size", "16px");
      if (state !== "loading") {
        await expect(content.locator("p")).toHaveCSS("font-size", "13px");
        expect(await content.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      }
      if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `empty-${state}-${width}.png`) });
    });
  }
}
