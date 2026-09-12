import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 960, height: 640 }, { width: 1440, height: 900 }]) {
  test(`long summary keeps body and keyboard actions reachable at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/e2e/player.html?summary=result&drawer&long-summary=1");
    await expect(page.locator(".summary-overview-copy p").first()).toBeInViewport();
    await page.getByRole("button", { name: "展开阅读", exact: true }).focus();
    const save = page.getByRole("button", { name: "保存 Markdown 报告", exact: true });
    let reached = false;
    for (let step = 0; step < 100; step++) {
      await page.keyboard.press("Tab");
      if (await save.evaluate(node => node === document.activeElement)) { reached = true; break; }
    }
    expect(reached).toBe(true);
    await expect(save).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-summary-action", "export");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "新建总结", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-summary-action", "new");
    expect(await page.locator(".player-drawer").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  });
}
