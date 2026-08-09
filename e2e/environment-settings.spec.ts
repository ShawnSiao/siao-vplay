import { expect, test } from "@playwright/test";

test("environment settings follows the approved compact provider layout", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.goto("/");

  await expect(page.locator(".desktop-commandbar .environment-navigation-trigger")).toHaveCount(0);
  const trigger = page.locator(".desktop-navigation .environment-navigation-trigger");
  await expect(trigger).toBeVisible();
  const bottomGroup = page.locator(".desktop-navigation-bottom");
  const resourceStatus = page.locator(".desktop-navigation-note");
  const [triggerBox, statusBox, groupBox, navigationBox] = await Promise.all([
    trigger.boundingBox(),
    resourceStatus.boundingBox(),
    bottomGroup.boundingBox(),
    page.locator(".desktop-navigation").boundingBox(),
  ]);
  expect(statusBox!.y - (triggerBox!.y + triggerBox!.height)).toBeLessThanOrEqual(10);
  expect(navigationBox!.y + navigationBox!.height - (groupBox!.y + groupBox!.height)).toBeLessThanOrEqual(10);
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

test("environment settings keeps the complete local-resource workflow", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.goto("/e2e/runtime.html?environment=1");

  const dialog = page.getByRole("dialog", { name: "环境配置" });
  const capabilities = dialog.getByRole("region", { name: "需要的功能" });
  await expect(dialog).toContainText("共享内容只下载一次");
  await expect(capabilities.getByText("基础视频支持")).toBeVisible();
  await expect(capabilities.getByText("在线视频导入")).toBeVisible();
  await expect(capabilities.getByText("本地字幕识别")).toBeVisible();
  await expect(dialog).toContainText("识别模型下载 148 MB");
  await expect(dialog).toContainText("识别模型下载 488 MB");
  await expect(dialog).toContainText("预计下载");
  await expect(dialog).toContainText("安装后占用");
  await expect(dialog.getByRole("button", { name: "选择现有资源目录" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "移动保存位置" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "检查与修复" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "清理旧版本" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "继续" })).toBeVisible();
  await expect(dialog.getByText("高级诊断与第三方许可")).toBeVisible();
  await expect(dialog.getByText("ffmpeg-cpu", { exact: true })).toBeHidden();
  expect(await dialog.evaluate((element) => (element as HTMLElement).innerText)).not.toMatch(
    /SHA-256|https:\/\/|SIAOVPLAY_/i,
  );
  await dialog.getByRole("button", { name: "检查与修复" }).click();
  await expect(dialog.locator(".local-resource-diagnostics")).toHaveAttribute("open", "");
  await expect(dialog.getByText("ffmpeg-cpu", { exact: true })).toBeVisible();
  expect(
    await dialog.locator(".environment-local-v3-scroll").evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
});
