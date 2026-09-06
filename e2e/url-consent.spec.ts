import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("X fallback disclosure uses the configured recipient and resets for another link", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/subtitle-translation.html?recovery=url");
  const url = page.getByRole("textbox", { name: "视频 URL" });
  await url.fill("https://x.com/example/status/12345678");
  const consent = page.getByRole("checkbox", { name: /允许直接解析失败后/ });
  await expect(consent).not.toBeChecked();
  await expect(page.getByText(/接收服务：https:\/\/resolver.example/)).toBeVisible();
  await consent.check();
  await expect(consent).toBeChecked();
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "url-consent-960.png"), fullPage: true });
  await url.fill("https://x.com/example/status/87654321");
  await expect(consent).not.toBeChecked();
  await url.fill("https://www.youtube.com/watch?v=example");
  await expect(consent).toHaveCount(0);
});
