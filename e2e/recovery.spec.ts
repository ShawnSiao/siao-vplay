import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("subtitle drafts survive navigation, explicit dismissal and repeated saves", async ({ page }) => {
  await page.goto("/e2e/subtitle-translation.html?recovery=revision");
  const editor = page.getByRole("textbox", { name: "简体中文字幕" });
  await editor.fill("保留的修正");
  await page.getByRole("button", { name: /translation 2/ }).click();
  await page.getByRole("button", { name: /translation 1/ }).click();
  await expect(editor).toHaveValue("保留的修正");
  await page.getByRole("tab", { name: /原文字幕/ }).click();
  await page.getByRole("tab", { name: /简体中文/ }).click();
  await expect(editor).toHaveValue("保留的修正");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(editor).toHaveValue("保留的修正");
  await page.getByRole("button", { name: "保存为新版本" }).click();
  await expect(page.getByText("已保存为版本 2，可以继续修正")).toBeVisible();
  await editor.fill("继续修正");
  await page.getByRole("button", { name: "保存为新版本" }).click();
  await expect(page.getByText("已保存为版本 3，可以继续修正")).toBeVisible();
  await expect(editor).toHaveValue("继续修正");
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "subtitle-revision.png"), fullPage: true });
});

test("preparation reports actual transcoding and separates returning from cancelling", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/subtitle-translation.html?recovery=preparation");
  await expect(page.getByText("生成兼容播放版本", { exact: true })).toBeVisible();
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "preparation-960.png"), fullPage: true });
  await page.getByRole("button", { name: "取消并返回媒体库" }).click();
  await expect(page.getByRole("button", { name: "正在取消…" })).toBeDisabled();
  await expect(page.getByText("正在停止处理", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回媒体库" }).click();
  await expect(page.getByText("已返回媒体库")).toBeVisible();
});
