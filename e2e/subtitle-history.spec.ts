import { expect, test } from "@playwright/test";
test("history read failure can be retried and the loaded revision dialog closes with Escape", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/player.html?subtitle-history");
  await page.evaluate(() => {
    const state = window as unknown as { historyFixture: Record<string, unknown>; historyFail: boolean; __TAURI_INTERNALS__: unknown };
    state.historyFail = true;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, input: { includeHistory: boolean }) => {
      if (state.historyFail) throw new Error("历史读取暂时失败");
      if (command === "list_subtitle_versions" && input.includeHistory === false) return [state.historyFixture];
      if (command === "list_subtitle_version_metadata") {
        const metadata = Object.fromEntries(Object.entries(state.historyFixture).filter(([key]) => !["segments", "preflight"].includes(key)));
        return [{ ...metadata, segmentCount: (state.historyFixture.segments as unknown[]).length }, { ...metadata, id: "historical-version", isCurrent: false, segmentCount: 75 }];
      }
      throw new Error("Unexpected history request");
    } };
  });
  await page.getByRole("button", { name: "修正字幕", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("历史读取暂时失败");
  await page.evaluate(() => { (window as unknown as { historyFail: boolean }).historyFail = false; });
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "轻量字幕修正" })).toBeVisible();
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(page.getByText("当前使用", { exact: true })).toBeVisible();
  await expect(page.getByText(/75 条/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "修正字幕", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
