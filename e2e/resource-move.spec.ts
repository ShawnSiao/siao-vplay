import { expect, test } from "@playwright/test";

test("resource copy cancellation remains reachable in the minimum settings window", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/runtime.html?environment=1&moving=1");
  await expect(page.getByText("正在复制并校验资源，原位置仍保留")).toBeVisible();
  const cancel = page.getByRole("button", { name: "取消复制" });
  await cancel.click();
  await expect(page.getByText("正在停止资源复制…")).toBeVisible();
  await expect(cancel).toBeDisabled();
  expect(errors).toEqual([]);
});
