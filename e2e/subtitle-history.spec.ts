import { expect, test } from "@playwright/test";
test("history read failure can be retried and the loaded revision dialog closes with Escape", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/player.html?subtitle-history");
  await page.evaluate(() => {
    const state = window as unknown as { historyFixture: Record<string, unknown>; historyFail: boolean; historyMalformed: boolean; __TAURI_INTERNALS__: unknown };
    state.historyFail = true;
    state.historyMalformed = true;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, input: { includeHistory: boolean }) => {
      if (state.historyFail) throw new Error("历史读取暂时失败");
      if (command === "list_subtitle_versions" && input.includeHistory === false) return [state.historyMalformed ? { ...state.historyFixture, preflight: {} } : state.historyFixture];
      if (command === "list_subtitle_metadata_page") {
        const metadata = Object.fromEntries(Object.entries(state.historyFixture).filter(([key]) => ["id", "trackId", "projectId", "role", "versionNumber", "status", "sourceLabel", "languageCode", "createdAtMs", "isCurrent"].includes(key)));
        const current = { ...metadata, segmentCount: (state.historyFixture.segments as unknown[]).length };
        return { projectId: metadata.projectId, offset: 0, totalCount: 2, nextOffset: null, snapshotToken: "a".repeat(64),
          currentVersions: [current], items: [current, { ...metadata, id: "historical-version", isCurrent: false, segmentCount: 75 }] };
      }
      throw new Error("Unexpected history request");
    } };
  });
  await page.getByRole("button", { name: "修正字幕", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("历史读取暂时失败");
  await page.evaluate(() => { (window as unknown as { historyFail: boolean }).historyFail = false; });
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("字幕版本格式无效");
  await page.evaluate(() => { (window as unknown as { historyMalformed: boolean }).historyMalformed = false; });
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "轻量字幕修正" })).toBeVisible();
  const segments = page.getByRole("tab", { name: "逐句修正", exact: true });
  await segments.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "历史版本", exact: true })).toBeFocused();
  await expect(segments).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "历史版本", exact: true })).toBeVisible();
  await expect(page.getByText("当前使用", { exact: true })).toBeVisible();
  await expect(page.getByText(/75 条/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "修正字幕", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test("history pages preserve a draft through failure and keyboard navigation at minimum size", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/player.html?subtitle-history");
  await page.evaluate(() => {
    const state = window as unknown as { historyFixture: Record<string, unknown>; failNext: boolean; __TAURI_INTERNALS__: unknown };
    state.failNext = true;
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: { input: { offset: number } }) => {
      if (command === "list_subtitle_versions") return [state.historyFixture];
      if (command !== "list_subtitle_metadata_page") throw new Error("Unexpected history request");
      const metadata = Object.fromEntries(Object.entries(state.historyFixture).filter(([key]) => ["id", "trackId", "projectId", "role", "versionNumber", "status", "sourceLabel", "languageCode", "createdAtMs", "isCurrent"].includes(key)));
      const current = { ...metadata, segmentCount: (state.historyFixture.segments as unknown[]).length };
      const all = [...Array.from({ length: 30 }, (_, index) => ({ ...current, id: `history-${30 - index}`,
        sourceLabel: `历史来源 ${30 - index}`, versionNumber: 31 - index, isCurrent: false })), current];
      const offset = args.input.offset;
      if (offset === 24 && state.failNext) { state.failNext = false; throw new Error("下一页暂时读取失败"); }
      return { projectId: metadata.projectId, offset, totalCount: 31, snapshotToken: "a".repeat(64),
        nextOffset: offset + 24 < 31 ? offset + 24 : null, currentVersions: [current], items: all.slice(offset, offset + 24) };
    } };
  });
  await page.getByRole("button", { name: "修正字幕", exact: true }).click();
  const editor = page.locator("textarea");
  await editor.fill("翻页后仍要保留的修正");
  await page.getByRole("tab", { name: "历史版本", exact: true }).click();
  await expect(page.locator(".revision-history-list article")).toHaveCount(24);
  await page.getByRole("button", { name: "下一页版本", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("下一页暂时读取失败");
  await expect(page.getByText("历史来源 30", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页版本", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".revision-history-list article")).toHaveCount(6);
  await expect(page.getByRole("group", { name: "字幕历史分页" })).toBeFocused();
  const layout = await page.evaluate(() => {
    const body = document.querySelector(".dialog-body")!.getBoundingClientRect();
    const first = document.querySelector(".revision-history-list article")!.getBoundingClientRect();
    const tabs = document.querySelector(".revision-track-switch")!.getBoundingClientRect();
    return { bodyTop: body.top, bodyBottom: body.bottom, firstTop: first.top, firstBottom: first.bottom, tabsTop: tabs.top };
  });
  expect(layout.firstTop).toBeGreaterThanOrEqual(layout.bodyTop);
  expect(layout.firstBottom).toBeLessThanOrEqual(layout.bodyBottom);
  expect(layout.tabsTop).toBeGreaterThanOrEqual(layout.bodyTop);
  await page.screenshot({ path: "designs/open-source-readiness/subtitle-history-page-960.png" });
  await page.getByRole("button", { name: "上一页版本", exact: true }).click();
  await expect(page.locator(".revision-history-list article")).toHaveCount(24);
  await page.getByRole("tab", { name: "逐句修正", exact: true }).click();
  await expect(editor).toHaveValue("翻页后仍要保留的修正");
});

test("delivery keeps the selected version and confirmation when paging", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/player.html?subtitle-history");
  await page.evaluate(() => {
    const state = window as unknown as { historyFixture: Record<string, unknown>; __TAURI_INTERNALS__: unknown };
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: { input: { offset: number } }) => {
      if (command === "list_subtitle_versions") return [state.historyFixture];
      if (command === "list_subtitle_burn_jobs") return [];
      if (command !== "list_subtitle_metadata_page") throw new Error("Unexpected delivery request");
      const metadata = Object.fromEntries(Object.entries(state.historyFixture).filter(([key]) => ["id", "trackId", "projectId", "role", "versionNumber", "status", "sourceLabel", "languageCode", "createdAtMs", "isCurrent"].includes(key)));
      const current = { ...metadata, segmentCount: (state.historyFixture.segments as unknown[]).length };
      const all = [...Array.from({ length: 30 }, (_, index) => ({ ...current, id: `export-${index}`, versionNumber: index + 2, isCurrent: false })), current];
      const offset = args.input.offset;
      return { projectId: metadata.projectId, offset, totalCount: 31, nextOffset: offset ? null : 24, snapshotToken: "a".repeat(64),
        currentVersions: [current], items: all.slice(offset, offset + 24) };
    } };
  });
  await page.getByRole("button", { name: "导出字幕", exact: true }).click();
  const version = page.getByRole("combobox", { name: "原文字幕版本", exact: true });
  await version.selectOption("export-0");
  const confirmation = page.getByRole("checkbox");
  await confirmation.check();
  await page.getByRole("button", { name: "下一页版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("25–31 / 31");
  await expect(version).toHaveValue("export-0");
  await expect(confirmation).toBeChecked();
  await expect(version.locator("option")).toHaveCount(8);
  await version.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "designs/open-source-readiness/subtitle-delivery-page-960.png" });
});
