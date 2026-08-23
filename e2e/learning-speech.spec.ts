import { expect, test } from "@playwright/test";

test("learning speech controls stay usable and explain a missing Windows voice", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
  await page.goto("/e2e/player.html?learning=speech", { waitUntil: "domcontentloaded" });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1200, height: 720 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("button", { name: "朗读当前整句" })).toBeVisible();
    await expect(page.getByRole("button", { name: "朗读选中的词语或短语" })).toBeVisible();
    await expect(page.getByText(/未找到英语声音/)).toBeVisible();
    await expect.poll(() => page.evaluate(
      () => document.body.scrollWidth <= document.body.clientWidth,
    )).toBe(true);
    await expect.poll(() => page.getByLabel("语言学习").evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    )).toBe(true);
  }

  await page.getByRole("button", { name: "scheduler", exact: false }).click();
  await expect(page.getByLabel("要查询的原文")).toHaveValue("scheduler");
  expect(consoleMessages).toEqual([]);
});
