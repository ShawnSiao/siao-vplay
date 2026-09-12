import { expect, test } from "@playwright/test";

for (const route of ["library.html", "library.html?empty=1", "runtime.html?environment", "player.html", "player.html?summary=progress&drawer", "player.html?summary=result&drawer", "dialog.html"]) {
  test(`visible controls have textual accessible names: ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`/e2e/${route}`);
    await page.locator("#root > *").first().waitFor();
    for (const role of ["button", "tab", "checkbox", "radio", "searchbox", "combobox"] as const) {
      const controls = page.getByRole(role).filter({ visible: true });
      const named = page.getByRole(role, { name: /[\p{L}\p{N}]/u }).filter({ visible: true });
      expect(await controls.count(), `${role}: ${await controls.evaluateAll(nodes => nodes.map(node => node.outerHTML).join("\n"))}`).toBe(await named.count());
    }
  });
}

for (const tab of ["剧集", "理解", "学习", "逐字稿"]) {
  test(`drawer controls expose text names and keyboard tabs: ${tab}`, async ({ page }) => {
    await page.goto("/e2e/player.html");
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: /^剧集/ }).click();
    const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
    const target = drawer.getByRole("tab", { name: tab, exact: true });
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(target).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Tab");
    await expect(drawer.getByRole("tabpanel", { name: tab, exact: true })).toBeFocused();
    for (const role of ["button", "tab", "checkbox", "radio", "searchbox", "combobox", "textbox"] as const) {
      const controls = drawer.getByRole(role).filter({ visible: true });
      const named = drawer.getByRole(role, { name: /[\p{L}\p{N}]/u }).filter({ visible: true });
      expect(await controls.count(), `${tab}: ${role}`).toBe(await named.count());
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });
}
