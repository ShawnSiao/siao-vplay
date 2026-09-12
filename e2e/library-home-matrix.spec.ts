import { expect, test } from "@playwright/test";

for (const count of [0, 1, 20, 1000]) {
  test(`home and search remain usable with ${count} media at minimum size`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`/e2e/library.html?homeCount=${count}`);
    const search = page.getByRole("searchbox", { name: "搜索媒体库" });
    await expect(search).toBeInViewport();
    for (const name of ["打开本地视频", "添加剧集文件夹", "从公开链接导入"]) {
      await expect(page.locator(".shell-add-media-actions").getByRole("button", { name, exact: true })).toBeInViewport();
    }
    expect(await page.locator("body").evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
    if (count) await expect(page.getByText("雨站台 1", { exact: true }).first()).toBeInViewport();
    await search.fill(count ? `雨站台 ${count}` : "不存在的媒体");
    const results = page.getByRole("listbox", { name: "媒体库搜索结果" });
    await expect(results).toBeVisible();
    if (count) {
      const result = results.getByRole("option").filter({ has: page.getByText(`雨站台 ${count}`, { exact: true }) });
      await expect(result).toBeInViewport();
      await result.focus();
      await expect(result).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("data-selected-project", `e2e-library-project-${count}`);
    } else await expect(results).toContainText("没有匹配内容");
    await search.fill("没有此标题");
    await expect(results).toContainText("没有匹配内容");
    await search.clear();
    await expect(results).toHaveCount(0);
  });
}

for (const count of [1, 20, 1000]) {
  test(`long titles and missing posters preserve home actions with ${count} media`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`/e2e/library.html?homeCount=${count}&long-list=1`);
    await expect(page.getByRole("button", { name: "继续播放", exact: true }).first()).toBeInViewport();
    await expect(page.locator(".shell-add-media-actions").getByRole("button", { name: "打开本地视频", exact: true })).toBeInViewport();
    const search = page.getByRole("searchbox", { name: "搜索媒体库" });
    await expect(search).toBeInViewport();
    await search.fill(`第 ${count} 集`);
    const result = page.getByRole("listbox", { name: "媒体库搜索结果" }).getByRole("option");
    await expect(result).toHaveCount(1);
    await expect(result).toBeInViewport();
    expect(await result.evaluate(node => node.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await result.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-selected-project", `e2e-library-project-${count}`);
    expect(await page.locator("body").evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
  });
}
