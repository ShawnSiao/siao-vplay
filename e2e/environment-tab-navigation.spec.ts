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
