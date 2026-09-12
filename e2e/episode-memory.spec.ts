import { expect, test } from "@playwright/test";

test("server episode pages preserve playback and support keyboard back navigation", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/player.html?episodeCount=10000&boundedEpisodes=1");
  const video = page.getByLabel("视频画面，单击播放或暂停");
  await video.evaluate(element => element.setAttribute("data-pagination-mount", "stable"));
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: /^剧集/ }).click();
  const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
  const rows = drawer.getByLabel("当前季剧集").getByRole("button");
  await expect(rows).toHaveCount(24);
  await drawer.getByRole("button", { name: "下一页剧集", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("status")).toHaveText("已显示 25–48 / 10000 集");
  await expect(rows).toHaveCount(24);
  await expect(rows.first()).toBeFocused();
  await expect(rows.first()).toContainText("第 25 集");
  const rowBox = await rows.first().boundingBox();
  const listBox = await drawer.getByLabel("当前季剧集").boundingBox();
  expect(rowBox && listBox && rowBox.y >= listBox.y && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1).toBeTruthy();
  await page.screenshot({ path: "designs/open-source-readiness/episode-memory-960.png" });
  await drawer.getByRole("button", { name: "上一页剧集", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("status")).toHaveText("已显示 24 / 10000 集");
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await expect(video).toHaveAttribute("data-pagination-mount", "stable");
});
