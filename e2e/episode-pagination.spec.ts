import { expect, test } from "@playwright/test";

test("episode pagination preserves rows on failure and supports keyboard retry", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/player.html?episodePages=1");
  const video = page.getByLabel("视频画面，单击播放或暂停");
  await video.evaluate(element => element.setAttribute("data-pagination-mount", "stable"));
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: /^剧集/ }).click();
  const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
  const rows = drawer.getByLabel("当前季剧集").getByRole("button");
  await expect(rows).toHaveCount(1);
  const more = drawer.getByRole("button", { name: "加载更多剧集", exact: true });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("alert")).toHaveText("读取暂时失败");
  await expect(rows).toHaveCount(1);
  const rowBox = await rows.first().boundingBox();
  const listBox = await drawer.getByLabel("当前季剧集").boundingBox();
  await page.screenshot({ path: "designs/open-source-readiness/episode-pagination-error-960.png" });
  expect(rowBox && listBox && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1).toBeTruthy();
  await drawer.getByRole("button", { name: "重试加载更多" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(2);
  await expect(drawer.getByRole("status")).toHaveText("已显示 2 / 2 集");
  await expect(drawer.getByRole("button", { name: /加载更多/ })).toHaveCount(0);
  await expect(video).toHaveAttribute("data-pagination-mount", "stable");
  await page.screenshot({ path: "designs/open-source-readiness/episode-pagination-960.png" });
});
