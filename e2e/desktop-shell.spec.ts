import { expect, test } from "@playwright/test";

test("empty media library keeps all three import actions directly visible", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto("/e2e/library.html?empty=1", { waitUntil: "domcontentloaded" });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1200, height: 720 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("heading", { name: "把海外视频变成可以连续看懂的内容" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "导入视频" })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开本地视频" })).toBeVisible();
    await expect(page.getByRole("button", { name: "添加剧集文件夹" })).toBeVisible();
    await expect(page.getByRole("button", { name: "从公开链接导入" })).toBeVisible();
    await expect(page.getByRole("button", { name: "添加视频" })).toHaveCount(0);
    await expect(page.getByText("不上传本地视频；向 AI 服务发送字幕或关键帧前会单独确认。"))
      .toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth))
      .toBe(true);
    await expect
      .poll(() => page.locator(".library-scroll").evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ))
      .toBe(true);
  }

  await page.getByRole("button", { name: "导入视频" }).click();
  const dialog = page.getByRole("dialog", { name: "导入视频" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /打开本地视频/ })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: /添加剧集文件夹/ })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: /从公开链接导入/ })).toBeEnabled();
  await expect(dialog).toContainText("不会绕过登录、付费或 DRM 限制");
  expect(consoleErrors).toEqual([]);
});

test("media home uses a compact responsive desktop shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/library.html", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("banner", { name: "应用命令栏" })).toHaveCSS(
    "height",
    "44px",
  );
  await expect(page.getByRole("button", { name: "打开本地视频" })).toBeEnabled();
  const openFolder = page.getByRole("button", { name: "添加剧集文件夹" });
  await expect(openFolder).toBeEnabled();
  await expect(page.getByRole("button", { name: "从公开链接导入" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "添加视频" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "专注观看，需要时再理解。" }),
  ).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "媒体库导航" })).toHaveCSS(
    "width",
    "220px",
  );
  await expect(page.locator(".library-continue-hero")).toHaveCount(1);
  await expect(page.getByText("00:42", { exact: true })).toBeVisible();
  await expect(page.getByText("03:00", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "剧集概览" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看全部" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "最近加入" })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "媒体库：稍后观看",
    }),
  ).toBeEnabled();
  await expect(page.getByText("字幕", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "更多", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("searchbox", { name: "搜索媒体库" }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "设置" })).toBeEnabled();
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
  await expect(page.getByRole("heading", { name: "未分类" })).toHaveCount(0);
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
  await expect(page.locator(".environment-navigation-trigger > span:last-child"))
    .toBeHidden();
});

test("media library scrolls to its last row above the status bar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/e2e/library.html", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "媒体库：未分类视频" }).click();

  const scroll = page.locator(".library-scroll");
  const statusbar = page.getByRole("contentinfo", { name: "媒体库状态" });
  const lastItem = page.locator(".library-media-item").last();
  const before = await scroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));

  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before.scrollTop).toBe(0);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(lastItem).toBeVisible();

  const lastItemBox = await lastItem.boundingBox();
  const statusbarBox = await statusbar.boundingBox();
  expect(lastItemBox).not.toBeNull();
  expect(statusbarBox).not.toBeNull();
  expect(lastItemBox!.y + lastItemBox!.height).toBeLessThanOrEqual(
    statusbarBox!.y + 1,
  );
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("folder recovery requires confirmation and blocks unsafe relocation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/library.html", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "媒体库：文件夹" }).click();
  await expect(page.getByRole("heading", { name: "授权文件夹", level: 2 })).toBeVisible();
  await expect(page.getByText("W:\\Series\\Rain")).toBeVisible();

  await page.getByRole("button", { name: "扫描更新 Rain" }).click();
  const rescan = page.getByRole("dialog", { name: "确认重新扫描结果" });
  await expect(rescan).toContainText("根目录当前离线");
  await expect(rescan.getByLabel("恢复结果分组")).toContainText("保持不变");
  await expect(rescan.getByLabel("恢复结果分组")).toContainText("需要确认");
  await expect(rescan.getByLabel("恢复结果分组")).toContainText("暂时离线");
  await expect
    .poll(() =>
      rescan.locator(".dialog-body").evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);
  const applyRescan = rescan.getByRole("button", { name: "应用扫描结果" });
  await expect(applyRescan).toBeDisabled();
  await rescan.getByRole("checkbox", { name: /确认将根目录与全部单集标记为离线/ }).check();
  await expect(applyRescan).toBeEnabled();
  await applyRescan.click();
  await expect(rescan).toHaveCount(0);

  await page.getByLabel("Rain 的文件夹操作").click();
  await page.getByRole("menuitem", { name: "更换位置" }).click();
  const relocation = page.getByRole("dialog", { name: "确认根目录重定位" });
  await expect(relocation).toContainText("新目录缺少文件");
  await expect(relocation.getByRole("button", { name: "更新根目录" })).toBeDisabled();
});

test("direct media lists remove successful classification changes", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/e2e/library.html", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "媒体库：稍后观看" }).click();
  await expect(page.getByRole("heading", { name: "稍后观看" })).toBeVisible();
  await expect(page.getByText("共 1 个视频，已加载 1 个。")).toBeVisible();
  await page.getByLabel("雨站台 的更多操作").click();
  await page.getByRole("menuitem", { name: "取消稍后观看" }).click();
  await expect(page.getByText("还没有稍后观看的视频")).toBeVisible();

  await page.getByRole("button", { name: "媒体库：未分类视频" }).click();
  await expect(page.getByRole("heading", { name: "未分类" })).toBeVisible();
  await expect(page.getByText("共 12 个视频，已加载 12 个。")).toBeVisible();
  await page.getByLabel("雨站台 1 的更多操作").click();
  await page.getByRole("menuitem", { name: "加入「周末电影」" }).click();
  await expect(page.getByText("共 11 个视频，已加载 11 个。")).toBeVisible();
  await expect(page.getByText("雨站台 1", { exact: true })).toHaveCount(0);
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

  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: /^剧集/ }).click();
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
  await expect(episodesDrawer.getByLabel("场景理解", { exact: true })).toBeVisible();
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

test("reading-first drawer exposes readable hierarchy and density controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/player.html");

  const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: /^剧集/ }).click();

  await expect(drawer).toHaveCSS("width", "416px");
  await expect(drawer.locator(".player-drawer-meta")).toContainText("正在观看");
  await expect(drawer.locator(".player-drawer-toolbar")).toBeVisible();
  await expect(drawer.locator(".player-drawer-toolbar")).toHaveCSS(
    "height",
    "54px",
  );
  await expect(
    drawer.getByRole("button", { name: "舒适", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.locator(".player-drawer-content")).toHaveCSS(
    "font-size",
    "15px",
  );

  await drawer.getByRole("button", { name: "紧凑", exact: true }).click();
  await expect(drawer).toHaveAttribute("data-density", "compact");
  await expect(
    drawer.getByRole("button", { name: "紧凑", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.setViewportSize({ width: 800, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
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

test("player more menu stays inside the viewport and supports internal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 263, height: 260 });
  await page.goto("/e2e/player.html");

  await page.getByRole("button", { name: "更多", exact: true }).click();
  const menu = page.locator(".shell-player-more-menu");
  await expect(menu).toBeVisible();
  const geometry = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(8);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 8);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);

  await menu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: /导出字幕与视频/ }),
  ).toBeVisible();
});

test("seek buttons, keyboard shortcuts, and the saved interval stay in sync", async ({
  page,
}) => {
  await page.goto("/e2e/player.html");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: "快进 10 秒" }).click();
  await expect(page.locator(".player-time")).toContainText("00:25 / 02:00");
  await page.getByRole("combobox", { name: "快进快退时长" }).selectOption("30");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("siaovplay-playback-seek-step-seconds"),
      ),
    )
    .toBe("30");
  await page.getByRole("button", { name: "快退 30 秒" }).click();
  await expect(page.locator(".player-time")).toContainText("00:00 / 02:00");

  await page.reload();
  await expect(page.getByRole("button", { name: "快退 30 秒" })).toBeVisible();
  await page.locator(".video-stage").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".player-time")).toContainText("00:45 / 02:00");
});

test("subtitle following, appearance, dragging, resizing, and controls remain complete", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto("/e2e/player.html");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1200, height: 720 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of ["字幕显示", "快进快退时长", "播放速度"])
      await expect(page.getByRole("combobox", { name })).toBeVisible();
    await expect(page.getByRole("button", { name: "字幕设置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "进入全屏" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const options = page.locator(".playback-options");
    const optionsBox = await options.boundingBox();
    expect(optionsBox).not.toBeNull();
    expect(optionsBox!.x + optionsBox!.width).toBeLessThanOrEqual(viewport.width);
    await expect(options.locator(".seek-step-field")).toContainText("跳转");
    await expect(page.getByRole("combobox", { name: "快进快退时长" })).toHaveValue("10");
    const controlWidths = await options.locator(":scope > *").evaluateAll((elements) =>
      elements.map((element) => ({ width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth })),
    );
    expect(controlWidths.every(({ width, scrollWidth }) => width + 1 >= scrollWidth)).toBe(true);
  }

  await expect(page.locator(".caption-line.original")).toHaveText("Okay, and that's essentially how the system stores the new memories.");
  await expect(page.locator(".caption-word.current")).toHaveText("essentially");
  await expect(page.getByText("这句话会跟随每一个单词。")).toBeVisible();
  await page.getByRole("button", { name: "字幕设置" }).click();
  const settings = page.getByRole("dialog", { name: "字幕设置" });
  await settings.getByRole("button", { name: "使用字幕默认颜色 #fef3c7" }).click();
  await settings.getByRole("button", { name: "使用当前词颜色 #fb923c" }).click();
  const colorState = await page.evaluate(() => {
    const stack = document.querySelector<HTMLElement>(".caption-stack")!;
    const spoken = document.querySelector<HTMLElement>(".caption-word.spoken")!;
    const current = document.querySelector<HTMLElement>(".caption-word.current")!;
    const translation = document.querySelector<HTMLElement>(".caption-line.translation")!;
    const original = document.querySelector<HTMLElement>(".caption-line.original")!;
    const stackStyle = getComputedStyle(stack);
    return {
      base: stack.style.getPropertyValue("--caption-base"),
      background: stackStyle.backgroundColor,
      filter: stackStyle.filter,
      spokenColor: getComputedStyle(spoken).color,
      currentDecoration: getComputedStyle(current).textDecorationLine,
      currentWeight: Number(getComputedStyle(current).fontWeight),
      originalWeight: Number(getComputedStyle(original).fontWeight),
      textShadow: getComputedStyle(original).textShadow,
      translationColor: getComputedStyle(translation).color,
      translationWeight: Number(getComputedStyle(translation).fontWeight),
    };
  });
  expect(colorState).toMatchObject({
    base: "#fef3c7",
    background: "rgba(5, 7, 9, 0.82)",
    filter: "none",
    spokenColor: "rgb(254, 243, 199)",
    currentDecoration: "none",
    originalWeight: 560,
    textShadow: "none",
    translationColor: "rgb(254, 243, 199)",
    translationWeight: 700,
  });
  expect(colorState.currentWeight).toBeGreaterThanOrEqual(700);
  const settingsBox = await settings.boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(settingsBox!.x).toBeGreaterThanOrEqual(0);
  expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(960);
  expect(settingsBox!.y).toBeGreaterThanOrEqual(0);
  expect(settingsBox!.y + settingsBox!.height).toBeLessThanOrEqual(640);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("siaovplay-subtitle-display-preferences-v3") ?? "{}").baseTextColor)).toBe("#fef3c7");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("siaovplay-subtitle-display-preferences-v3") ?? "{}").highlightColor)).toBe("#fb923c");
  await settings.getByRole("checkbox", { name: "原文逐词跟随" }).uncheck();
  await expect(page.locator(".caption-word")).toHaveCount(0);
  await settings.getByRole("checkbox", { name: "原文逐词跟随" }).check();
  await settings.getByRole("button", { name: "关闭字幕设置" }).click();

  await page.reload();
  await expect.poll(() => page.locator(".caption-stack").evaluate((element) => (element as HTMLElement).style.getPropertyValue("--caption-base"))).toBe("#fef3c7");

  const caption = page.locator(".caption-stack");
  const before = await caption.boundingBox();
  if (!before) throw new Error("missing caption");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 80, before.y + before.height / 2 - 40);
  await page.mouse.up();
  const moved = await caption.boundingBox();
  expect(moved?.x).toBeLessThan(before.x - 40);
  const storedPosition = await page.evaluate(() => JSON.parse(window.localStorage.getItem("siaovplay-subtitle-display-preferences-v3") ?? "{}").position);
  expect(storedPosition.x).toBeLessThan(0.5);
  await page.reload();
  const restored = await caption.boundingBox();
  expect(restored?.x).toBeLessThan(before.x - 40);
  await page.getByRole("button", { name: "字幕设置" }).click();
  const resetSettings = page.getByRole("dialog", { name: "字幕设置" });
  await resetSettings.getByRole("button", { name: "恢复默认位置" }).click();
  await resetSettings.getByRole("button", { name: "关闭字幕设置" }).click();
  expect((await caption.boundingBox())?.x).toBeGreaterThan(restored?.x ?? 0);

  const beforeResize = await caption.boundingBox();
  if (!beforeResize) throw new Error("missing caption before resize");
  await caption.hover();
  const widthHandle = page.getByRole("button", {
    name: "调整字幕框宽度",
    exact: true,
  });
  const widthHandleBox = await widthHandle.boundingBox();
  if (!widthHandleBox) throw new Error("missing caption width handle");
  await page.mouse.move(
    widthHandleBox.x + widthHandleBox.width / 2,
    widthHandleBox.y + widthHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    widthHandleBox.x + widthHandleBox.width / 2 + 90,
    widthHandleBox.y + widthHandleBox.height / 2,
  );
  await page.mouse.up();
  const resized = await caption.boundingBox();
  expect(resized?.width).toBeGreaterThan(beforeResize.width + 60);
  expect(Math.abs((resized?.x ?? 0) - beforeResize.x)).toBeLessThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("siaovplay-subtitle-display-preferences-v3") ?? "{}").frameSize.widthRatio)).toBeGreaterThan(0.3);
  await page.reload();
  const restoredSize = await caption.boundingBox();
  expect(restoredSize?.width).toBeGreaterThan(beforeResize.width + 60);
  await page.getByRole("button", { name: "字幕设置" }).click();
  const sizeSettings = page.getByRole("dialog", { name: "字幕设置" });
  await sizeSettings.getByRole("button", { name: "恢复默认尺寸" }).click();
  await sizeSettings.getByRole("button", { name: "关闭字幕设置" }).click();
  expect((await caption.boundingBox())?.width).toBeLessThan(restoredSize?.width ?? Number.POSITIVE_INFINITY);

  const beforeHeightResize = await caption.boundingBox();
  if (!beforeHeightResize) throw new Error("missing caption before height resize");
  await caption.hover();
  await page.getByRole("button", { name: "调整字幕框高度", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  const heightResized = await caption.boundingBox();
  expect(heightResized?.height).toBeGreaterThan(beforeHeightResize.height + 10);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("siaovplay-subtitle-display-preferences-v3") ?? "{}").frameSize.minHeightRatio)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "字幕设置" }).click();
  const resetSizeSettings = page.getByRole("dialog", { name: "字幕设置" });
  await resetSizeSettings.getByRole("button", { name: "恢复默认尺寸" }).click();
  await resetSizeSettings.getByRole("button", { name: "关闭字幕设置" }).click();

  const reset = await caption.boundingBox();
  if (!reset) throw new Error("missing reset caption");
  await page.mouse.move(reset.x + reset.width / 2, reset.y + reset.height / 2);
  await page.mouse.down();
  const stageBox = await page.locator(".video-stage").boundingBox();
  if (!stageBox) throw new Error("missing video stage");
  await page.mouse.move(reset.x + reset.width / 2, stageBox.y + stageBox.height - 1);
  await page.mouse.up();
  const bottomGeometry = await page.evaluate(() => {
    const captionRect = document.querySelector(".caption-stack")!.getBoundingClientRect();
    const stageRect = document.querySelector(".video-stage")!.getBoundingClientRect();
    return { captionBottom: captionRect.bottom, stageBottom: stageRect.bottom };
  });
  expect(Math.abs(bottomGeometry.captionBottom - bottomGeometry.stageBottom)).toBeLessThanOrEqual(1);
  expect(consoleErrors).toEqual([]);
});

test("fullscreen uses the whole stage and hides controls after inactivity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/e2e/player.html");

  await page.getByRole("button", { name: "进入全屏" }).click();
  const player = page.locator(".player-screen");
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await expect(player).toHaveClass(/fullscreen-player/);
  const geometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    return {
      stage: box(".video-stage"),
      controls: box(".player-controls"),
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.stage.bottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 1);
  expect(geometry.controls.top).toBeLessThan(geometry.stage.bottom);
  expect(geometry.controls.bottom).toBeLessThanOrEqual(geometry.stage.bottom + 1);

  await expect(player).toHaveClass(/controls-hidden/, { timeout: 4_000 });
  await page.mouse.move(320, 240);
  await expect(player).not.toHaveClass(/controls-hidden/);
  await page.getByRole("button", { name: "退出全屏" }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);
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

test("local resources stay product-focused, accessible, and scrollable at 1280 by 720", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/e2e/runtime.html");

  const dialog = page.getByRole("dialog", { name: "本地功能资源" });
  const body = dialog.locator(".dialog-body");
  const actions = dialog.locator(".dialog-actions");
  const before = {
    dialog: await dialog.boundingBox(),
    actions: await actions.boundingBox(),
  };

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("共享内容不会重复下载");
  await expect(dialog).toContainText("不会使用隐式系统盘目录");
  await expect(dialog).toContainText("识别模型下载 148 MB");
  await expect(dialog).toContainText("识别模型下载 488 MB");
  await dialog.getByText("高级维护：存储位置、迁移、修复和清理").click();
  await expect(dialog.getByRole("button", { name: "选择现有资源目录" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "移动保存位置" })).toBeVisible();
  expect(await dialog.evaluate((element) => (element as HTMLElement).innerText)).not.toMatch(
    /FFmpeg|yt-dlp|Whisper|SHA-256|https:\/\/|SIAOVPLAY_/i,
  );
  await expect(dialog.getByText("ffmpeg-cpu", { exact: true })).toBeHidden();
  await expect(dialog.getByText(/SHA-256/).first()).toBeHidden();
  await expect(
    dialog.getByRole("progressbar", { name: "在线视频导入准备进度" }),
  ).toHaveAttribute("aria-valuenow", "50");
  await dialog.getByRole("button", { name: "继续" }).click();
  await expect(dialog).toContainText("正在下载");
  expect(await body.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await body.evaluate((element) => element.clientHeight),
  );

  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await dialog.getByText("高级诊断与第三方许可").click();
  await expect(dialog.getByText("当前使用内置可信目录清单")).toBeVisible();
  await expect(dialog.getByText("2026.05.01（活动）")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "回退到 2026.04.01" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "复制脱敏诊断摘要" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "完成" })).toBeVisible();
  expect(await dialog.boundingBox()).toEqual(before.dialog);
  expect(await actions.boundingBox()).toEqual(before.actions);
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const evidencePath = process.env.SIAOVPLAY_E2E_EVIDENCE_PATH;
  if (evidencePath) {
    await dialog
      .getByRole("button", { name: "回退到 2026.04.01" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidencePath });
  }
});
