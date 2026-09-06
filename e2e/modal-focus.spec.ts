import { expect, test } from "@playwright/test";

test("nested modal traps focus, makes the background inert and closes one layer", async ({ page }) => {
  await page.goto("/e2e/dialog.html");
  await page.keyboard.press("Escape");
  const open = page.getByRole("button", { name: "打开可读性检查" });
  await open.click();
  const outer = page.getByRole("dialog", { name: "字幕导入检查", exact: true });
  const trigger = outer.getByRole("button", { name: "打开嵌套检查" });
  await trigger.click();
  const inner = page.getByRole("dialog", { name: "嵌套检查", exact: true });
  await expect(inner.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
  await expect(page.locator("main > button")).toHaveAttribute("inert", "");
  await page.keyboard.press("Shift+Tab");
  await expect(inner.getByRole("button", { name: "末尾操作" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(inner.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
  await page.locator("main > button").evaluate((element) => (element as HTMLElement).focus());
  await expect(inner.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inner).toHaveCount(0);
  await expect(outer).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(outer).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(open).not.toHaveAttribute("inert");
});
