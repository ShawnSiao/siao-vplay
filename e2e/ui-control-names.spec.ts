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
