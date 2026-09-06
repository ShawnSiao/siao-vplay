import { expect, test } from "@playwright/test";

test("provider drafts survive navigation and dismissal requires an explicit discard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("tab", { name: "AI 服务" }).click();
  await settings.getByRole("button", { name: "OpenAI 未配置" }).click();
  const key = settings.getByPlaceholder("粘贴服务商提供的 API Key");
  await key.fill("synthetic-draft-only");
  await expect(key).toBeFocused();
  await settings.getByRole("button", { name: "DeepSeek 未配置" }).click();
  await settings.getByRole("button", { name: "OpenAI 未配置" }).click();
  await expect(key).toHaveValue("synthetic-draft-only");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(settings).toBeVisible();
  await expect(key).toHaveValue("synthetic-draft-only");
  page.once("dialog", (dialog) => dialog.accept());
  await settings.getByRole("button", { name: "关闭设置" }).click();
  await expect(settings).toHaveCount(0);
});

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

  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "AI 服务" }).click();
  await expect(dialog.locator(".environment-provider-list .environment-provider-row")).toHaveCount(7);
  await expect(dialog.getByRole("button", { name: "＋ 添加其他服务" })).toHaveCount(1);
  const providerLogos = dialog.locator(".environment-provider-logo img");
  await expect(providerLogos).toHaveCount(7);
  expect(
    await providerLogos.evaluateAll((images) => images.every((image) => {
      const logo = image as HTMLImageElement;
      return logo.complete && logo.naturalWidth > 0;
    })),
  ).toBe(true);
  await expect(dialog.locator('[data-logo-provider="kimi"]')).toHaveCSS("background-color", "rgb(8, 12, 34)");

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
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("tab", { name: "AI 服务" }).click();
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

  const dialog = page.getByRole("dialog", { name: "设置" });
  const capabilities = dialog.getByRole("region", { name: "需要的功能" });
  await expect(dialog).toContainText("共享内容只下载一次");
  await expect(capabilities.getByText("基础视频支持")).toBeVisible();
  await expect(capabilities.getByText("在线视频导入")).toBeVisible();
  await expect(capabilities.getByText("本地字幕识别")).toBeVisible();
  await expect(dialog).toContainText("识别模型下载 148 MB");
  await expect(dialog).toContainText("识别模型下载 488 MB");
  await expect(dialog).toContainText("预计下载");
  await expect(dialog).toContainText("安装后占用");
  await dialog.getByText("高级维护：存储位置、迁移、修复和清理").click();
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1200, height: 720 },
  { width: 960, height: 640 },
]) {
  test(`storage settings remains usable at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    const consoleProblems: string[] = [];
    page.on("console", (entry) => {
      if (["error", "warning"].includes(entry.type())) consoleProblems.push(entry.text());
    });
    await page.setViewportSize(viewport);
    await page.goto("/e2e/runtime.html?environment=1&storage=1");
    const dialog = page.getByRole("dialog", { name: "设置" });
    await dialog.getByRole("tab", { name: "存储" }).click();
    await expect(dialog.getByRole("region", { name: "存储位置" })).toBeVisible();
    await expect(dialog.getByText("应用数据与数据库")).toBeVisible();
    await expect(dialog.getByText("URL 导入视频")).toBeVisible();
    await expect(dialog.getByText("播放缓存")).toBeVisible();
    await expect(dialog.getByText("视频与分析报告")).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await dialog.getByRole("button", { name: "迁移" }).click();
    const migration = page.getByRole("dialog", { name: "迁移应用数据与数据库" });
    await migration.getByRole("button", { name: "选择文件夹" }).click();
    await migration.getByRole("button", { name: "检查迁移条件" }).click();
    await expect(migration.getByRole("button", { name: "开始迁移" })).toBeVisible();
    await migration.getByRole("button", { name: "开始迁移" }).click();
    await expect(migration.getByText("新目录已通过校验。")).toBeVisible();
    expect(await migration.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(consoleProblems).toEqual([]);
  });
}
