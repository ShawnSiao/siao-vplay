import { expect, test } from "@playwright/test";
for (const count of [1000, 10000]) {
  test(`episode drawer bounds ${count} rows without remounting video`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: count === 1000 ? 640 : 720 });
    await page.goto(`/e2e/player.html?episodePages=1&episodeCount=${count}`);
    const video = page.getByLabel("视频画面，单击播放或暂停");
    await video.evaluate(element => element.setAttribute("data-window-mount", "stable"));
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: /^剧集/ }).click();
    const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
    const list = drawer.getByLabel("当前季剧集");
    const rows = list.getByRole("button");
    await expect(rows).toHaveCount(24);
    await drawer.getByRole("button", { name: "下一页剧集" }).focus(); await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(24);
    await expect(rows.first()).toContainText("第 25 集");
    await expect(rows.first()).toBeFocused(); await expect(rows.first()).toBeInViewport();
    const first = await rows.first().boundingBox(), bounds = await list.boundingBox();
    expect(first && bounds && first.y + first.height <= bounds.y + bounds.height + 1).toBeTruthy();
    await expect(drawer.getByRole("status")).toHaveText(`已显示 25–48 / ${count} 集`);
    await page.screenshot({ path: `designs/open-source-readiness/episode-window-${count}.png` });
    await drawer.getByRole("button", { name: "上一页剧集" }).focus(); await page.keyboard.press("Enter");
    await expect(rows.first()).toContainText("第 1 集");
    await expect(video).toHaveAttribute("data-window-mount", "stable");
  });
}
