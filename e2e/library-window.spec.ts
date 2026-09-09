import { expect, test } from "@playwright/test";
import { join } from "node:path";
for (const count of [1000, 10000]) {
  test(`${count} loaded collection rows keep bounded DOM and keyboard paging`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const url = `/e2e/library.html?collection-pages=${count}`;
    const rows = page.locator(".library-episodes .library-media-item");
    await page.goto(url); await expect(rows).toHaveCount(24);
    const samples: number[] = [];
    for (let index = 0; index < (process.env.SIAOVPLAY_LIBRARY_RENDER_BENCHMARK === "1" ? 20 : 1); index++) {
      await page.goto(url); await expect(rows).toHaveCount(24);
      const elapsed = await page.evaluate(async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return performance.now();
      });
      samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    console.info(JSON.stringify({ scenario: `library collection ${count} preloaded`, samples: samples.length, renderedRows: 24,
      navigationToObservedRowsMs: { median: samples.length % 2 ? samples[Math.floor(samples.length / 2)] : (samples[samples.length / 2 - 1] + samples[samples.length / 2]) / 2, p95: samples[Math.ceil(samples.length * .95) - 1] } }));
    const next = page.getByRole("button", { name: "下一页剧集" });
    await next.focus(); await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(24);
    await expect(rows.first()).toContainText("视频 episode-25");
    await expect(rows.first().locator("button").first()).toBeFocused();
    await expect(rows.first()).toBeInViewport();
    await expect(page.getByText("已显示 25–48 / " + count + " 集")).toBeVisible();
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `library-window-${count}.png`) });
    await page.getByRole("button", { name: "上一页剧集" }).focus(); await page.keyboard.press("Enter");
    await expect(rows.first()).toContainText("视频 episode-1");
    await expect(rows.first().locator("button").first()).toBeFocused();
    expect(errors).toEqual([]);
  });
}
