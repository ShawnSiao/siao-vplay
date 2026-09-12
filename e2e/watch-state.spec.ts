import { expect, test } from "@playwright/test";

test("watched status can be corrected without opening the media", async ({ page }) => {
  await page.goto("/e2e/library.html");
  await page.getByRole("button", { name: "媒体库：未分类" }).click();
  const item = page.locator(".library-media-item").first();
  await item.getByRole("button", { name: /更多操作/ }).click();
  await page.getByRole("menuitem", { name: "标记为看完" }).click();
  await expect(item).toContainText("已看完");
  await item.getByRole("button", { name: /更多操作/ }).click();
  await page.getByRole("menuitem", { name: "标记为未看" }).click();
  await expect(item).not.toContainText("已看完");
});

test("player sends completion only after forward playback since the latest seek", async ({ page }) => {
  await page.goto("/e2e/player.html");
  await page.locator("video").waitFor({ state: "attached" });
  await page.locator("video").evaluate(video => {
    for (const [key, value] of Object.entries({ currentTime: 100, duration: 100, paused: true, ended: true, seeking: false })) {
      Object.defineProperty(video, key, { configurable: true, writable: true, value });
    }
    video.dispatchEvent(new Event("seeked"));
    video.dispatchEvent(new Event("ended"));
  });
  const saves = () => page.evaluate(() => (window as unknown as { playbackSaves: { completed?: boolean }[] }).playbackSaves);
  await expect.poll(saves).toContainEqual(expect.objectContaining({ positionMs: 100000 }));
  expect((await saves()).some(save => save.completed === true)).toBe(false);
  await page.locator("video").evaluate(video => {
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 99 });
    Object.defineProperty(video, "paused", { configurable: true, writable: true, value: false });
    video.dispatchEvent(new Event("seeked"));
    video.dispatchEvent(new Event("play"));
    video.currentTime = 100;
    video.dispatchEvent(new Event("timeupdate"));
    video.dispatchEvent(new Event("ended"));
  });
  await expect.poll(async () => (await saves()).some(save => save.completed === true)).toBe(true);
});
