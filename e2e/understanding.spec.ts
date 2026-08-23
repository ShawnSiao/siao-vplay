import { expect, test } from "@playwright/test";

test("deep understanding result stays readable across target viewports", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
  await page.goto("/e2e/player.html?understanding=result", {
    waitUntil: "domcontentloaded",
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1200, height: 720 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByText("本次材料范围")).toBeVisible();
    await expect(page.getByText("1 条字幕")).toBeVisible();
    await expect(page.getByText("1 张关键帧")).toBeVisible();
    await expect(page.getByText("12 条结果")).toBeVisible();
    await expect(page.getByText("第 6 条带依据的分析内容。").first()).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth))
      .toBe(true);
    await expect
      .poll(() => page.getByLabel("场景理解").evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ))
      .toBe(true);
  }

  await page.getByRole("button", { name: "展开全部" }).first().click();
  await expect(page.getByText("第 6 条带依据的分析内容。").first()).toBeVisible();
  expect(consoleMessages).toEqual([]);
});

test("video summary progress and evidence report stay usable across target viewports", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1200, height: 720 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/e2e/player.html?summary=progress", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("已完成 3 / 7 段")).toBeVisible();
    await expect(page.getByRole("button", { name: "取消总结" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);

    await page.goto("/e2e/player.html?summary=result", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("从即时状态到外部记忆")).toBeVisible();
    await expect(page.getByText("视频明确陈述")).toBeVisible();
    await expect(page.getByText("字幕或画面证据")).toBeVisible();
    await expect(page.getByText("AI 推导")).toBeVisible();
    await expect(page.getByText("待外部验证")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存 Markdown 报告" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
    await expect.poll(() => page.getByLabel("视频总结预览").evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    )).toBe(true);
  }
  expect(consoleMessages).toEqual([]);
});
