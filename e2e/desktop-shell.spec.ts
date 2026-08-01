import { expect, test } from "@playwright/test";

test("media home uses a compact responsive desktop shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("banner", { name: "应用命令栏" })).toHaveCSS(
    "height",
    "44px",
  );
  await expect(
    page.getByRole("button", {
      name: "打开文件夹，文件夹与剧集导入将在 Phase 7D 启用",
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "专注观看，需要时再理解。" }),
  ).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "媒体库导航" })).toHaveCSS(
    "width",
    "220px",
  );

  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(page.getByRole("complementary", { name: "媒体库导航" })).toHaveCSS(
    "width",
    "52px",
  );
});

test("drawers and context menu preserve the mounted video", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 720 });
  await page.goto("/e2e/player.html");

  const video = page.getByLabel("视频画面，单击播放或暂停");
  await video.evaluate((element) => {
    element.setAttribute("data-mount-token", "stable-video");
  });
  const stageWidth = await page.locator(".player-primary").evaluate(
    (element) => element.getBoundingClientRect().width,
  );

  await page.getByRole("button", { name: "剧集", exact: true }).click();
  const episodesDrawer = page.getByRole("complementary", { name: "剧集抽屉" });
  await expect(episodesDrawer).toBeVisible();
  await expect(episodesDrawer).toHaveCSS("position", "absolute");
  await expect(video).toHaveAttribute("data-mount-token", "stable-video");
  expect(
    await page.locator(".player-primary").evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
  ).toBe(stageWidth);

  await page.keyboard.press("Escape");
  await expect(episodesDrawer).toHaveCount(0);
  await page.locator(".video-stage").dispatchEvent("contextmenu", {
    clientX: 320,
    clientY: 220,
  });
  await expect(page.getByRole("menu", { name: "播放器右键菜单" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "播放器右键菜单" })).toHaveCount(0);
});

test("playback shortcuts ignore editable controls and drop feedback is explicit", async ({
  page,
}) => {
  await page.goto("/e2e/player.html?drop=ready");

  await expect(page.getByRole("status")).toContainText("松开以导入这个视频");
  const video = page.getByLabel("视频画面，单击播放或暂停");
  const speed = page.getByRole("combobox");
  await speed.focus();
  await page.keyboard.press("m");
  await expect(video).toHaveJSProperty("muted", false);

  await page.locator(".video-stage").focus();
  await page.keyboard.press("m");
  await expect(video).toHaveJSProperty("muted", true);
  await page.keyboard.press("]");
  await expect(speed).toHaveValue("1.25");
});
