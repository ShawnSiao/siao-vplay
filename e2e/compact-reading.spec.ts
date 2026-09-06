import { expect, test } from "@playwright/test";
import { join } from "node:path";

test("compact home keeps resume and search usable at the minimum window", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/library.html");
  const hero = page.locator(".library-continue-hero");
  await expect(hero).toBeVisible();
  expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(180);
  await expect(page.getByRole("searchbox", { name: "搜索媒体库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开本地视频" })).toBeVisible();
  expect((await page.getByRole("banner", { name: "应用命令栏" }).boundingBox())!.height).toBeLessThanOrEqual(48);
  expect(await page.locator(".library-scroll").evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "compact-library-actual-960.png") });
});

test("drawer puts content after one context row and tabs, with reading settings collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/player.html");
  await page.getByRole("button", { name: "更多", exact: true }).waitFor();
  await page.evaluate(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "get_codex_runtime_status") return { available: false };
        if (command === "get_ai_service_settings") return { services: [], defaultServiceId: null };
        if (["list_explanation_tasks", "list_explanations", "list_analysis_prompt_templates"].includes(command)) return [];
        throw new Error(`Unexpected fixture IPC: ${command}`);
      },
    };
  });
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: /^剧集/ }).click();
  const drawer = page.locator(".player-drawer");
  await expect(drawer).toBeVisible();
  const content = page.locator(".player-drawer-content");
  expect((await content.boundingBox())!.y - (await drawer.boundingBox())!.y).toBeLessThanOrEqual(110);
  await expect(page.getByRole("button", { name: "紧凑", exact: true })).toBeHidden();
  await page.getByText("阅读设置", { exact: true }).click();
  await page.getByRole("button", { name: "紧凑", exact: true }).click();
  await expect(drawer).toHaveAttribute("data-density", "compact");
  await page.getByText("阅读设置", { exact: true }).click();
  await drawer.getByRole("tab", { name: "理解", exact: true }).click();
  await expect(drawer.getByText(/Cannot read|Unexpected fixture IPC/)).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "准备理解材料" })).toBeVisible();
  expect((await drawer.locator(".spoiler-boundary").boundingBox())!.height).toBeLessThanOrEqual(76);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "compact-player-actual-960.png") });
});
