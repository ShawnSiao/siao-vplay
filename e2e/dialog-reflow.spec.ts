import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const [route, title] of [["dialog", "字幕导入检查"], ["subtitle-translation", "准备原文字幕"], ["runtime", "本地功能资源"]]) {
  for (const width of [872, 768, 640, 480]) {
    test(`${route} dialog reflows and contains keyboard focus at ${width}px`, async ({ page }) => {
      const height = Math.floor(width * 2 / 3);
      await page.setViewportSize({ width, height });
      await page.goto(`/e2e/${route}.html`);
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
      if (route === "runtime") await dialog.getByText("高级维护：存储位置、迁移、修复和清理").click();
      const body = dialog.locator(".dialog-body");
      if (width === 480) expect((await body.boundingBox())!.height).toBeGreaterThanOrEqual(96);
      expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const smallText = await body.locator("p, small, label").evaluateAll((elements) => elements.filter((element) => {
        const bounds = element.getBoundingClientRect(); return bounds.width && bounds.height && getComputedStyle(element).visibility !== "hidden";
      }).filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12).map((element) => element.className));
      expect(smallText).toEqual([]);
      if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `dialog-reflow-${route}-${width}.png`) });
      await dialog.getByRole("button", { name: "关闭", exact: true }).focus();
      for (let index = 0; index < 24; index++) {
        await page.keyboard.press(index < 12 ? "Tab" : "Shift+Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
    });
  }
}
