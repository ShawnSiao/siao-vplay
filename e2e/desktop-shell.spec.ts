import { expect, test } from "@playwright/test";

test("media home uses a compact responsive desktop shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/library.html");

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
    page.getByRole("button", {
      name: "打开文件夹，文件夹与剧集导入将在 Phase 7D 启用",
    }),
  ).toHaveCSS("opacity", "0.78");
  await expect(
    page.getByRole("button", {
      name: "打开文件夹，文件夹与剧集导入将在 Phase 7D 启用",
    }),
  ).toHaveCSS(
    "background-image",
    "linear-gradient(rgba(195, 241, 135, 0.72), rgba(169, 220, 105, 0.68))",
  );
  await expect(
    page.getByRole("heading", { name: "专注观看，需要时再理解。" }),
  ).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "媒体库导航" })).toHaveCSS(
    "width",
    "220px",
  );
  await expect(page.locator(".continue-item")).toHaveCount(1);
  await expect(page.getByText("00:42 / 03:00").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "剧集" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看全部 ›" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "最近加入" })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "媒体库：稍后观看",
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "字幕，需要打开视频后使用" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "更多命令，需要打开视频后使用" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("searchbox", { name: "搜索媒体库" }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "设置，内容待定义" })).toBeDisabled();
  await expect(page.getByRole("contentinfo", { name: "媒体库状态" })).toHaveCSS(
    "height",
    "26px",
  );
  await expect(page.getByRole("contentinfo", { name: "媒体库状态" })).toContainText(
    "1 个剧集文件",
  );
  await expect(page.getByRole("contentinfo", { name: "媒体库状态" })).toContainText(
    "0 个授权文件夹",
  );
  await expect(page.locator(".library-item-list")).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(0);

  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(page.getByRole("complementary", { name: "媒体库导航" })).toHaveCSS(
    "width",
    "52px",
  );
  await expect(page.locator(".desktop-navigation-section")).toBeHidden();
  await expect(page.locator(".desktop-navigation-note")).toBeHidden();
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
  expect(stageWidth).toBeGreaterThan(1100);
  await expect(
    page.getByRole("complementary", { name: "媒体库导航" }),
  ).toHaveCount(0);
  await expect(page.locator(".media-pills")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /上一集/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /下一集/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "进入全屏" })).toBeVisible();

  await page.getByRole("button", { name: "剧集", exact: true }).click();
  const episodesDrawer = page.getByRole("complementary", { name: "当前内容抽屉" });
  await expect(episodesDrawer).toBeVisible();
  await expect(episodesDrawer).toHaveCSS("position", "absolute");
  await expect(episodesDrawer.getByRole("tab", { name: "剧集" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await episodesDrawer.getByRole("tab", { name: "理解" }).click();
  await expect(episodesDrawer.getByRole("tab", { name: "理解" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(episodesDrawer.getByLabel("场景理解")).toBeVisible();
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
  const contextMenu = page.getByRole("menu", { name: "播放器右键菜单" });
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(contextMenu.getByRole("menuitem", { name: /静音/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    contextMenu.getByRole("menuitem", { name: "返回媒体库" }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(contextMenu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(contextMenu).toHaveCount(0);
  await expect(page.locator(".video-stage")).toBeFocused();

  await page.locator(".video-stage").dispatchEvent("contextmenu", {
    clientX: 320,
    clientY: 220,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "播放器右键菜单" })).toHaveCount(0);
});

test("playback shortcuts ignore editable controls and drop feedback is explicit", async ({
  page,
}) => {
  await page.goto("/e2e/player.html?drop=ready");

  await expect(page.getByRole("status")).toContainText("松开以导入这个视频");
  const video = page.getByLabel("视频画面，单击播放或暂停");
  const speed = page.getByRole("combobox", { name: "播放速度" });
  await speed.focus();
  await page.keyboard.press("m");
  await expect(video).toHaveJSProperty("muted", false);

  await page.locator(".video-stage").focus();
  await page.keyboard.press("m");
  await expect(video).toHaveJSProperty("muted", true);
  await page.keyboard.press("]");
  await expect(speed).toHaveValue("1.25");
});

test("dialog keeps its frame fixed and scrolls only the content at 900px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/dialog.html");

  const dialog = page.getByRole("dialog", { name: "字幕导入检查" });
  const body = dialog.locator(".dialog-body");
  const heading = page.getByRole("heading", { name: "字幕导入检查" });
  const actions = dialog.locator(".dialog-actions");
  const before = {
    heading: await heading.boundingBox(),
    actions: await actions.boundingBox(),
  };

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("overflow", "hidden");
  await expect(body).toHaveCSS("overflow", "auto");
  expect(await dialog.evaluate((element) => element.scrollHeight)).toBe(
    await dialog.evaluate((element) => element.clientHeight),
  );
  expect(await body.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await body.evaluate((element) => element.clientHeight),
  );
  expect((await dialog.boundingBox())?.height).toBeLessThanOrEqual(836);
  await expect(dialog.locator(".eyebrow")).toHaveCSS("font-size", "12px");
  await expect(body.locator("p").first()).toHaveCSS("font-size", "13px");
  await expect(dialog.locator("small")).toHaveCSS("font-size", "12px");
  await expect(dialog.locator("label")).toHaveCSS("font-size", "13px");

  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await heading.boundingBox()).toEqual(before.heading);
  expect(await actions.boundingBox()).toEqual(before.actions);
});
