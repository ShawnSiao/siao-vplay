import { expect, test } from "@playwright/test";

test("environment settings follows the approved compact provider layout", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.goto("/");

  await expect(page.locator(".desktop-commandbar .environment-navigation-trigger")).toHaveCount(0);
  const trigger = page.locator(".desktop-navigation .environment-navigation-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "环境配置" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "AI 服务" }).click();
  await expect(dialog.locator(".environment-provider-list .environment-provider-row")).toHaveCount(7);
  await expect(dialog.getByRole("button", { name: "＋ 添加其他服务" })).toHaveCount(1);

  await dialog.getByRole("button", { name: "OpenAI 未配置" }).click();
  await expect(dialog.getByRole("heading", { name: "配置 OpenAI" })).toBeVisible();
  await expect(dialog.getByPlaceholder("粘贴服务商提供的 API Key")).toHaveCount(1);
  await expect(dialog.locator(".environment-provider-detail")).toHaveJSProperty(
    "scrollHeight",
    await dialog.locator(".environment-provider-detail").evaluate((element) => element.clientHeight),
  );
});

test("environment settings keeps its header and footer fixed at 960 by 640", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "环境配置" });
  await dialog.getByRole("button", { name: "AI 服务" }).click();
  await dialog.getByRole("button", { name: "OpenAI 未配置" }).click();

  const header = dialog.locator(".environment-settings-header");
  const footer = dialog.locator(".environment-settings-footer");
  const content = dialog.locator(".environment-settings-content");
  const [headerBox, footerBox, contentBox] = await Promise.all([
    header.boundingBox(),
    footer.boundingBox(),
    content.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(contentBox!.y + 1);
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(640);
  await expect(dialog.locator(".environment-detail-scroll")).toHaveCSS("overflow-y", "auto");
});
