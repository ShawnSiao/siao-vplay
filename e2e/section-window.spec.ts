import { expect, test } from "@playwright/test";

for (const section of ["unclassified", "watch_later", "home"]) {
  test(`${section} pages recover and support keyboard back navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`/e2e/library.html?section-window=26&section=${section}`);
    const list = page.getByRole("group", { name: section === "home" ? "继续观看列表" : "视频列表", exact: true });
    await expect(list.getByRole("status")).toHaveText("已显示 24 / 26 个视频");
    await list.getByRole("button", { name: "下一页视频", exact: true }).click();
    await expect(list.getByRole("alert")).toHaveText("读取暂时失败");
    await list.getByRole("button", { name: "重试读取", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(list.getByRole("status")).toHaveText("已显示 25–26 / 26 个视频");
    await expect(list.getByRole("button").first()).toBeFocused();
    if (section !== "home") await expect(list.locator(".library-media-item")).toHaveCount(2);
    await page.screenshot({ path: `designs/open-source-readiness/section-window-${section}-960.png` });
    await list.getByRole("button", { name: "上一页视频", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(list.getByRole("status")).toHaveText("已显示 24 / 26 个视频");
    await expect(list.getByRole("button").first()).toBeFocused();
  });
}
