import { expect, test } from "@playwright/test";
test("history read failure can be retried and the loaded revision dialog closes with Escape", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/player.html?subtitle-history");
  await page.evaluate(() => {
    const state = window as unknown as { historyFixture: unknown; historyFail: boolean; __TAURI_INTERNALS__: unknown };
    state.historyFail = true;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, input: { includeHistory: boolean }) => {
      if (command !== "list_subtitle_versions" || input.includeHistory !== true) throw new Error("Unexpected history request");
      if (state.historyFail) throw new Error("历史读取暂时失败");
      return [state.historyFixture];
    } };
  });
  await page.getByRole("button", { name: "修正字幕", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("历史读取暂时失败");
  await page.evaluate(() => { (window as unknown as { historyFail: boolean }).historyFail = false; });
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "轻量字幕修正" })).toBeVisible();
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(page.getByText("当前使用", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "修正字幕", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
