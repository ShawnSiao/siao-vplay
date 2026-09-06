import { expect, test } from "@playwright/test";

test("playback advances without changing the learning draft or prepared context", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as { prepared: unknown[]; __TAURI_INTERNALS__: unknown };
    state.prepared = [];
    state.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      switch (command) {
        case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true };
        case "get_ai_service_settings": return { services: [], defaultServiceId: null };
        case "list_learning_tasks": case "list_dictionary_entries": case "list_learning_cards": case "list_speech_voices": return [];
        case "prepare_learning_task": state.prepared.push(args); throw new Error("测试夹具：已检查材料参数，未创建任务");
        default: throw new Error(`Unexpected fixture IPC: ${command}`);
      }
    } };
  });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto("/e2e/player.html?ai-confirm=learning&learning-context=1");
  const input = page.getByRole("textbox", { name: "要查询的原文" });
  await input.fill("Okay");
  await page.getByRole("button", { name: "测试：播放下一句" }).click();
  await expect(input).toHaveValue("Okay");
  await expect(page.getByText("已保留正在学习的台词。", { exact: true })).toBeVisible();
  if (process.env.SIAOVPLAY_E2E_EVIDENCE_PATH) await page.screenshot({ path: process.env.SIAOVPLAY_E2E_EVIDENCE_PATH });
  await page.getByRole("button", { name: "准备查询材料" }).click();
  await expect(page.getByRole("alert")).toContainText("未创建任务");
  expect(await page.evaluate(() => (window as unknown as { prepared: unknown[] }).prepared)).toEqual([
    { input: { projectId: "e2e-project", handoffKind: "codex", sourceSegmentId: "e2e-original-segment", selectedText: "Okay", selectionKind: "word", playbackPositionMs: 15000 } },
  ]);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "学习当前台词" }).click();
  await expect(input).toHaveValue("Okay");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "学习当前台词" }).click();
  await expect(input).toHaveValue("Another example sentence.");
  expect(errors).toEqual([]);
});


test("closing and switching the drawer preserves learning input and receiver", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      convertFileSrc: () => "",
      invoke: async (command: string) => {
        switch (command) {
          case "get_codex_runtime_status": return { available: true, authenticated: true, supported: true };
          case "get_ai_service_settings": return { services: [], defaultServiceId: null };
          case "list_learning_tasks": case "list_dictionary_entries": case "list_learning_cards": case "list_speech_voices": return [];
          default: throw new Error(`Unexpected fixture IPC: ${command}`);
        }
      },
    };
  });
  await page.goto("/e2e/player.html");
  const openDrawer = async () => {
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: /^剧集/ }).click();
    await page.getByRole("tab", { name: "学习", exact: true }).click();
  };
  await openDrawer();
  const input = page.getByRole("textbox", { name: "要查询的原文" });
  await input.fill("Okay");
  const manual = page.getByRole("button", { name: /复制提示词/ });
  await manual.click();
  await page.getByRole("tab", { name: "逐字稿" }).click();
  await expect(input).toHaveCount(0);
  await page.getByRole("tab", { name: "学习", exact: true }).click();
  await expect(input).toHaveValue("Okay");
  await expect(manual).toHaveClass("selected");
  await page.getByRole("button", { name: "关闭右侧抽屉" }).click();
  await expect(input).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "当前内容抽屉" })).toHaveCount(0);
  await openDrawer();
  await expect(input).toHaveValue("Okay");
  await expect(manual).toHaveClass("selected");
  expect(errors).toEqual([]);
});
