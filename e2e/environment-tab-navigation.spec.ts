import { expect, test } from "@playwright/test";

test("environment tabs use manual keyboard activation and linked panels", async ({ page }) => {
  await page.goto("/e2e/runtime.html?environment&storage");
  const dialog = page.getByRole("dialog", { name: "设置" });
  const local = dialog.getByRole("tab", { name: "本地功能", exact: true });
  await expect(local).toHaveAttribute("aria-selected", "true");
  await local.focus();
  await page.keyboard.press("End");
  const storage = dialog.getByRole("tab", { name: "存储", exact: true });
  await expect(storage).toBeFocused();
  await expect(local).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(storage).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await storage.getAttribute("id"))!);
  await page.keyboard.press("Home");
  await expect(local).toBeFocused();
  await page.keyboard.press("Space");
  await expect(local).toHaveAttribute("aria-selected", "true");
});


test("storage default draft survives tab navigation and cache maintenance", async ({ page }) => {
  await page.goto("/e2e/runtime.html?environment&storage");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("tab", { name: "存储", exact: true }).click();
  await dialog.getByRole("button", { name: "选择默认位置", exact: true }).click();
  const draft = dialog.getByText("D:\\SiaoVPlay\\Subtitles", { exact: true });
  await expect(draft).toBeVisible();
  await dialog.getByRole("tab", { name: "本地功能", exact: true }).click();
  await dialog.getByRole("tab", { name: "存储", exact: true }).click();
  await expect(draft).toBeVisible();
  await dialog.getByRole("button", { name: "清理缓存", exact: true }).click();
  await dialog.getByRole("button", { name: "确认清理", exact: true }).click();
  await expect(draft).toBeVisible();
});


for (const close of ["escape", "button", "backdrop", "later"] as const) {
  test(`storage drafts require explicit discard on ${close}`, async ({ page }) => {
    await page.goto("/e2e/runtime.html?environment&storage&firstRun");
    const dialog = page.getByRole("dialog", { name: "设置" });
    await dialog.getByRole("tab", { name: "存储", exact: true }).click();
    await dialog.getByRole("button", { name: "选择默认位置", exact: true }).click();
    await dialog.getByRole("tab", { name: "本地功能", exact: true }).click();
    const messages: string[] = [];
    page.on("dialog", async confirmation => {
      messages.push(confirmation.message());
      if (messages.length === 1) await confirmation.dismiss(); else await confirmation.accept();
    });
    const dismiss = () => close === "escape" ? page.keyboard.press("Escape") : close === "button"
      ? dialog.getByRole("button", { name: "关闭设置" }).click()
      : close === "later" ? dialog.getByRole("button", { name: "稍后配置" }).click()
      : page.locator(".environment-settings-scrim").click({ position: { x: 2, y: 2 } });
    await dismiss();
    await expect(dialog).toBeVisible();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("存储");
    await dismiss();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "重新打开设置" }).click();
    await dialog.getByRole("tab", { name: "存储", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "选择默认位置", exact: true })).toBeVisible();
  });
}

test("saved non-default directories can be reset without making another edit first", async ({ page }) => {
  await page.goto("/e2e/runtime.html?environment&storage");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("tab", { name: "存储", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "恢复默认", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "应用设置", exact: true })).toBeEnabled();
});
