import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const width of [1440, 960, 480]) {
  for (const surface of ["library", "player"]) {
    test(`${surface} layout stays bounded at ${width}px`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`/e2e/${surface}.html`);
      const target = page.locator(surface === "library" ? ".library-screen" : ".control-row");
      await expect(target).toBeVisible();
      const layout = await target.evaluate(node => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return { display: style.display, columns: style.gridTemplateColumns, rows: style.gridTemplateRows,
          width: rect.width, height: rect.height, left: rect.left, right: rect.right, background: style.backgroundColor };
      });
      console.info(JSON.stringify({ surface, width, layout }));
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
      if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `${surface}-${width}.png`) });
    });
  }
}
