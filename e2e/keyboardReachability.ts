import { expect, type Locator, type Page } from "@playwright/test";

/** Verify the rendered native tab stops, including actions below long content. */
export async function verifyKeyboardReachability(page: Page, root: Locator) {
  const candidates = await root.locator("button:visible:enabled, input:visible:enabled, textarea:visible:enabled, select:visible:enabled, a[href]:visible, summary:visible").all();
  const stops: Locator[] = [];
  for (const candidate of candidates) {
    if (await candidate.evaluate(element => (element as HTMLElement).tabIndex >= 0 && !element.closest("[inert]"))) stops.push(candidate);
  }
  expect(stops.length).toBeGreaterThan(0);
  const reached = new Set<number>();
  await stops[0].focus();
  for (let step = 0; step < stops.length * 4 + 20; step++) {
    for (let index = 0; index < stops.length; index++) {
      if (await stops[index].evaluate(element => element === document.activeElement)) {
        reached.add(index);
        await expect(stops[index]).toBeInViewport();
      }
    }
    if (reached.size === stops.length) break;
    await page.keyboard.press("Tab");
  }
  const missing: string[] = [];
  for (let index = 0; index < stops.length; index++) {
    if (!reached.has(index)) missing.push(await stops[index].evaluate(element => element.getAttribute("aria-label") || element.textContent || element.tagName));
  }
  expect(missing, "every rendered native tab stop must be reachable").toEqual([]);
}
