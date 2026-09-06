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


for (const empty of [false, true]) {
  test(`library reflows at 200% equivalent layout, empty=${empty}`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 320 });
    await page.goto(`/e2e/library.html${empty ? "?empty=1" : ""}`);
    const search = page.getByRole("searchbox", { name: "搜索媒体库" });
    await expect(search).toBeVisible();
    const bounds = await search.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(480);
    expect(await page.locator(".library-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const name of ["打开本地视频", "添加剧集文件夹", "从公开链接导入"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.focus();
      await expect(button).toBeFocused();
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(480);
    }
    if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, `library-200-${empty}.png`) });
  });
}


test("player menu and drawer remain inside a 200% equivalent layout", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 320 });
  await page.goto("/e2e/player.html");
  const more = page.getByRole("button", { name: "更多", exact: true });
  await more.focus();
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(480);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(320);
  await page.getByRole("menuitem", { name: /^剧集/ }).click();
  const drawer = page.getByRole("complementary", { name: "当前内容抽屉" });
  const box = await drawer.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(480);
  expect(box!.y + box!.height).toBeLessThanOrEqual(320);
  expect((await drawer.locator(".player-drawer-content").boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await drawer.getByRole("tab", { name: "逐字稿" }).click();
  expect(await drawer.locator(".player-drawer-content").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  if (process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.SIAOVPLAY_DESIGN_CAPTURE_DIR, "player-200.png") });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});
