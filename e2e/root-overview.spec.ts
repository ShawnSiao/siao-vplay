import { expect, test } from "@playwright/test";

test("folder pages stay bounded and preserve recovery actions and keyboard position", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/library.html?rootCount=1000&root-retry=1");
  await page.getByRole("button", { name: "媒体库：文件夹" }).click();
  const view = page.locator(".library-folders-page");
  await expect(view.locator(".library-folder-row")).toHaveCount(24);
  await view.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(view.getByRole("alert")).toContainText("读取暂时失败");
  await expect(view.getByRole("button", { name: "扫描更新 目录 1", exact: true })).toBeDisabled();
  await view.getByRole("button", { name: "重试读取" }).click();
  await expect(view.locator(".library-folder-row")).toHaveCount(24);
  await expect(view.getByRole("button", { name: "扫描更新 目录 26", exact: true })).toBeFocused();
  expect(await view.locator('[data-root-id="root-25"]').evaluate(row => {
    const copy = row.querySelector(".library-folder-copy")!.getBoundingClientRect();
    const actions = row.querySelector(".library-folder-row-actions")!.getBoundingClientRect();
    return Math.abs((copy.top + copy.bottom) / 2 - (actions.top + actions.bottom) / 2);
  })).toBeLessThan(2);
  expect(await view.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "designs/open-source-readiness/root-overview-960.png" });
  const menu = view.getByRole("button", { name: "目录 26 的文件夹操作", exact: true });
  await menu.click();
  await page.getByRole("menuitem", { name: "撤销授权", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "撤销文件夹授权？" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await view.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(view.getByRole("button", { name: "扫描更新 目录 1", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
