import { expect, test } from "@playwright/test";

test("settings is fetched on demand and a failed import stays contained", async ({ page }) => {
  let requests = 0;
  await page.route(/\/assets\/EnvironmentSettingsDialog-[^/]+\.js$/, async route => {
    requests += 1;
    if (requests === 1) await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/");
  expect(requests).toBe(0);
  const trigger = page.getByRole("button", { name: "设置", exact: true });
  await trigger.click();
  await expect(page.getByRole("alert")).toContainText("界面加载失败");
  await expect(page.getByRole("alert")).toContainText("保存当前工作后重启应用");
  await page.getByRole("button", { name: "关闭提示" }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toBe(1);
  await trigger.click();
  await expect(page.getByRole("alert")).toBeVisible();
  // Explicit restart of this empty preview proves recovery without an automatic reload.
  await page.reload();
  await trigger.click();
  await expect(page.getByRole("tab", { name: "AI 服务", exact: true })).toBeVisible();
  expect(requests).toBe(2);
});

test("closing during load does not reopen settings when the module arrives", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/assets\/EnvironmentSettingsDialog-[^/]+\.js$/, async route => {
    await held;
    await route.continue();
  });
  try {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "设置", exact: true });
    await trigger.click();
    await expect(page.getByRole("status")).toContainText("正在打开");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const response = page.waitForResponse(/\/assets\/EnvironmentSettingsDialog-[^/]+\.js$/);
    release();
    await response;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await trigger.click();
    await expect(page.getByRole("tab", { name: "AI 服务", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    await expect(trigger).toBeFocused();
  } finally { release(); }
});
