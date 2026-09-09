import { expect, test } from "@playwright/test";
for (const [section, count] of [["unclassified", 1000], ["watch_later", 10000]] as const) {
  test(`${section} bounds ${count} loaded rows and preserves actions`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`/e2e/library.html?mediaCount=${count}&section=${section}`);
    const rows = page.locator(".library-media-list-page .library-media-item");
    await expect(rows).toHaveCount(24);
    await page.getByRole("button", { name: "下一页视频" }).focus(); await page.keyboard.press("Enter");
    await expect(rows.first()).toContainText("雨站台 25");
    await expect(rows.first().locator("button").first()).toBeFocused();
    await expect(rows).toHaveCount(24);
    if (section === "watch_later") {
      await rows.first().getByRole("button", { name: /的更多操作/ }).click();
      await page.getByRole("menuitem", { name: "取消稍后观看" }).click();
      await expect(rows.first()).toContainText("雨站台 26");
      await expect(rows.first().locator("button").first()).toBeFocused();
    }
    await page.screenshot({ path: `designs/open-source-readiness/media-window-${section}.png` });
    await page.getByRole("button", { name: "上一页视频" }).focus(); await page.keyboard.press("Enter");
    await expect(rows.first()).toContainText("雨站台 1");
    await expect(rows.first().locator("button").first()).toBeFocused();
  });
}
