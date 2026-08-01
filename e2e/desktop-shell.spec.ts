import { expect, test } from "@playwright/test";

test("media home uses a compact responsive desktop shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/library.html");

  await expect(page.getByRole("banner", { name: "应用命令栏" })).toHaveCSS(
    "height",
    "44px",
  );
  const openFolder = page.getByRole("button", { name: "打开剧集文件夹" }).first();
  await expect(openFolder).toBeEnabled();
  await expect(openFolder).toHaveCSS(
    "background-image",
    "linear-gradient(rgb(195, 241, 135), rgb(169, 220, 105))",
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
    "1 个授权文件夹",
  );
  await expect(page.locator(".library-item-list")).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(0);

  await openFolder.click();
  const importDialog = page.getByRole("dialog", { name: "确认剧集识别结果" });
  await expect(importDialog).toBeVisible();
  await expect(importDialog).toContainText("1待导入");
  await expect(importDialog).toContainText("1待确认");
  const importButton = importDialog.getByRole("button", { name: "导入 1 集" });
  await expect(importButton).toBeDisabled();
  await importDialog.getByLabel("Special.mp4 集号").fill("2");
  await importDialog.getByRole("checkbox", { name: "确认 Special.mp4" }).check();
  await expect(importButton).toBeEnabled();
  await importButton.click();
  await expect(importDialog).toHaveCount(0);

  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(page.getByRole("complementary", { name: "媒体库导航" })).toHaveCSS(
    "width",
    "52px",
  );
  await expect(page.locator(".desktop-navigation-section")).toBeHidden();
  await expect(page.locator(".desktop-navigation-note")).toBeHidden();
});

test("folder recovery requires confirmation and blocks unsafe relocation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/library.html");
  await page.getByRole("button", { name: "媒体库：文件夹" }).click();
  await expect(page.getByRole("heading", { name: "授权文件夹", level: 1 })).toBeVisible();
  await expect(page.getByText("W:\\Series\\Rain")).toBeVisible();

  await page.getByRole("button", { name: "重新扫描 Rain" }).click();
  const rescan = page.getByRole("dialog", { name: "确认重新扫描结果" });
  await expect(rescan).toContainText("根目录当前离线");
  const applyRescan = rescan.getByRole("button", { name: "应用扫描结果" });
  await expect(applyRescan).toBeDisabled();
  await rescan.getByRole("checkbox", { name: /确认将根目录与全部单集标记为离线/ }).check();
  await expect(applyRescan).toBeEnabled();
  await applyRescan.click();
  await expect(rescan).toHaveCount(0);

  await page.getByRole("button", { name: "重新定位 Rain" }).click();
  const relocation = page.getByRole("dialog", { name: "确认根目录重定位" });
  await expect(relocation).toContainText("新目录缺少文件");
  await expect(relocation.getByRole("button", { name: "更新根目录" })).toBeDisabled();
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
  await expect(page.getByRole("button", { name: /下一集/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "进入全屏" })).toBeVisible();

  await page.getByRole("button", { name: "剧集", exact: true }).click();
  const episodesDrawer = page.getByRole("complementary", { name: "当前内容抽屉" });
  await expect(episodesDrawer).toBeVisible();
  await expect(episodesDrawer).toHaveCSS("position", "absolute");
  await expect(episodesDrawer.getByRole("tab", { name: "剧集" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(episodesDrawer).toContainText("雨夜列车");
  await expect(episodesDrawer.getByLabel("当前季剧集")).toContainText("正在播放");
  await expect(episodesDrawer.getByLabel("当前季剧集")).toContainText("未观看");
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

test("keeps the progress bar and playback controls outside the video surface", async ({
  page,
}) => {
  for (const viewport of [
    { width: 960, height: 640 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/e2e/player.html");

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          throw new Error(`missing ${selector}`);
        }
        const box = element.getBoundingClientRect();
        return {
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          left: box.left,
          width: box.width,
          height: box.height,
        };
      };
      return {
        stage: rect(".video-stage"),
        video: rect(".video-stage video"),
        controls: rect(".player-controls"),
        seek: rect(".seek-control"),
        primary: rect(".player-primary"),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentHeight: document.documentElement.scrollHeight,
      };
    });

    expect(geometry.controls.top).toBeGreaterThanOrEqual(geometry.stage.bottom - 1);
    expect(geometry.seek.top).toBeGreaterThanOrEqual(geometry.stage.bottom - 1);
    expect(geometry.controls.bottom).toBeLessThanOrEqual(geometry.primary.bottom + 1);
    expect(geometry.video.top).toBeGreaterThanOrEqual(geometry.stage.top);
    expect(geometry.video.bottom).toBeLessThanOrEqual(geometry.stage.bottom + 1);
    expect(geometry.video.right).toBeLessThanOrEqual(geometry.stage.right + 1);
    expect(geometry.video.left).toBeGreaterThanOrEqual(geometry.stage.left - 1);
    expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewport.height);
  }
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
