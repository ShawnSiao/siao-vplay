import { expect, test } from "@playwright/test";
import { join } from "node:path";

test("requested import capability does not require transcription choices", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/runtime.html?environment&pending=url_import");
  const dialog = page.getByRole("dialog", { name: "环境配置" });
  await expect(dialog.getByText("继续当前操作", { exact: true })).toBeVisible();
  await expect(dialog.getByText("字幕识别方式", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: "选择准备本地字幕识别" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "移动保存位置", exact: true })).toBeHidden();
  await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("requested transcription keeps its model choice available", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/runtime.html?environment&pending=local_transcription");
  const dialog = page.getByRole("dialog", { name: "环境配置" });
  await expect(dialog.getByRole("radio", { name: /轻量/ })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "选择准备在线视频导入" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "开始准备所选功能" })).toBeEnabled();
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "focused-transcription-preparation-960.png") });
});
