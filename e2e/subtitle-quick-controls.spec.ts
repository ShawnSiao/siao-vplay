import { expect, test } from "@playwright/test";

test("subtitle quick controls share state with the player and open the transcript", async ({
  page,
}) => {
  await page.goto("/e2e/player.html", { waitUntil: "domcontentloaded" });

  const caption = page.locator(".caption-stack");
  await expect(caption).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "字幕快捷控制" })).toHaveAttribute(
    "data-visible",
    "true",
  );

  await page.locator("video").dispatchEvent("play");
  await expect(page.getByRole("toolbar", { name: "字幕快捷控制" })).toHaveAttribute(
    "data-visible",
    "false",
  );
  await caption.hover();
  await expect(page.getByRole("toolbar", { name: "字幕快捷控制" })).toHaveCSS(
    "opacity",
    "1",
  );
  await page.locator("video").dispatchEvent("pause");

  await page.getByRole("combobox", { name: "字幕字号" }).selectOption("large");
  await expect(caption).toHaveAttribute("data-text-size", "large");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".caption-stack")).toHaveAttribute("data-text-size", "large");
  await page.getByRole("button", { name: "隐藏原文" }).click();
  await expect(page.locator(".caption-line.original")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "字幕显示" })).toHaveValue(
    "translation",
  );

  await page.getByRole("button", { name: "展开逐字稿" }).click();
  const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("tab", { name: "逐字稿" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(drawer.getByRole("button", { name: /Okay, and that's essentially/ })).toHaveAttribute(
    "aria-current",
    "true",
  );

  const transcriptList = drawer.getByRole("region", { name: "字幕列表" });
  await transcriptList.hover();
  await page.mouse.wheel(0, 200);
  await expect(drawer.getByText("已暂停自动跟随")).toBeVisible();
  await drawer.getByRole("button", { name: "回到当前句" }).first().click();
  await expect(drawer.getByText("已暂停自动跟随")).toHaveCount(0);

  await drawer.getByRole("searchbox", { name: "搜索逐字稿" }).fill(
    "e2e-original-segment",
  );
  await expect(drawer.getByText("没有匹配内容")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "展开逐字稿" })).toBeFocused();

  await page.getByRole("button", { name: "关闭字幕" }).click();
  await expect(page.getByText("字幕已关闭")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "字幕显示" })).toHaveValue("off");
  await page.getByRole("button", { name: "重新显示字幕" }).click();
  await expect(caption).toBeVisible();

  await page.getByRole("button", { name: "字幕设置" }).click();
  const settings = page.getByRole("dialog", { name: "字幕设置" });
  const toolbarMode = settings.getByRole("combobox", {
    name: "字幕快捷工具栏显示",
  });
  await toolbarMode.selectOption("hidden");
  await expect(page.getByRole("toolbar", { name: "字幕快捷控制" })).toHaveCount(0);
  await toolbarMode.selectOption("auto");
  await expect(page.getByRole("toolbar", { name: "字幕快捷控制" })).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 900, drawerWidth: 416 },
  { width: 1200, height: 720, drawerWidth: 396 },
  { width: 960, height: 640, drawerWidth: 396 },
]) {
  test(`transcript layout has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/e2e/player.html", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "展开逐字稿" }).click();
    const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
    await expect(drawer).toHaveCSS("width", `${viewport.drawerWidth}px`);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      player: document.querySelector(".player-screen")!.scrollWidth -
        document.querySelector(".player-screen")!.clientWidth,
      captionCoveredByDrawer:
        document.querySelector(".caption-stack")!.getBoundingClientRect().right >
        document.querySelector(".player-drawer")!.getBoundingClientRect().left,
    }));
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.player).toBeLessThanOrEqual(0);
    expect(overflow.captionCoveredByDrawer).toBe(false);
  });
}

for (const variant of [
  { background: "light", script: "thai" },
  { background: "complex", script: "japanese" },
  { background: "dark", script: "korean" },
]) {
  test(`${variant.script} captions wrap on a ${variant.background} video background`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(
      `/e2e/player.html?captionBackground=${variant.background}&subtitleScript=${variant.script}`,
      { waitUntil: "domcontentloaded" },
    );
    const geometry = await page.evaluate(() => {
      const caption = document.querySelector(".caption-stack")!.getBoundingClientRect();
      const stage = document.querySelector(".video-stage")!.getBoundingClientRect();
      return {
        insideHorizontally:
          caption.left >= stage.left && caption.right <= stage.right,
        insideVertically: caption.top >= stage.top && caption.bottom <= stage.bottom,
        originalLines: Math.round(
          document.querySelector(".caption-line.original")!.getBoundingClientRect().height /
            Number.parseFloat(
              getComputedStyle(document.querySelector(".caption-line.original")!).lineHeight,
            ),
        ),
      };
    });
    expect(geometry.insideHorizontally).toBe(true);
    expect(geometry.insideVertically).toBe(true);
    expect(geometry.originalLines).toBeGreaterThanOrEqual(1);
  });
}
