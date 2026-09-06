import { expect, test } from "@playwright/test";

test("subtitle tabs use arrows for focus and Enter for activation", async ({ page }) => {
  await page.goto("/e2e/subtitle-translation.html");
  const list = page.getByRole("tablist", { name: "字幕准备方式" });
  const original = list.getByRole("tab", { name: "导入字幕" });
  const translation = list.getByRole("tab", { name: "翻译", exact: true });
  await original.focus();
  await page.keyboard.press("End");
  await expect(translation).toBeFocused();
  await expect(original).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "确认范围并开始翻译" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(translation).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "翻译", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel", { name: "翻译", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(translation).toBeFocused();
  await page.keyboard.press("Home");
  await expect(original).toBeFocused();
  await page.keyboard.press("Space");
  await expect(original).toHaveAttribute("aria-selected", "true");
});
