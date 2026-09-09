import { beforeEach, expect, it, vi } from "vitest";
import { inspectRemoteMediaUrl, cancelRemoteMediaImport } from "./desktop";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
const url = "https://example.com/video.mp4";
const preview = {originalUrl:url, finalUrl:"https://cdn.example.com/video.mp4", displayName:"video.mp4", mediaKind:"direct_file", contentType:"video/mp4", contentLength:10, previewToken:"a".repeat(64)};
it.each([null, {}, {...preview, originalUrl:"https://example.com/other.mp4"}, {...preview, finalUrl:"file:///private"}, {...preview, finalUrl:"https://user:password@example.com/file"}, {...preview, contentLength:-1}, {...preview, contentLength:1.5}, {...preview, mediaKind:"unknown"}, {...preview, previewToken:"bad"}, {...preview, displayName:""}])("rejects unrelated or malformed preview %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(inspectRemoteMediaUrl(url)).rejects.toThrow();
});
it.each(["direct_file", "hls"])("accepts %s preview with unknown size", async mediaKind => {
  const value = {...preview, mediaKind, contentLength:null, contentType:null};
  mocks.invoke.mockResolvedValue(value);
  await expect(inspectRemoteMediaUrl(" HTTPS://EXAMPLE.COM:443/video.mp4 ")).resolves.toEqual(value);
});
it.each([null, {}, 1, "false"])("rejects malformed cancellation %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(cancelRemoteMediaImport("operation")).rejects.toThrow();
});

it.each([true, false])("retains boolean cancellation %s", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(cancelRemoteMediaImport("operation")).resolves.toBe(value);
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_remote_media_import", {input:{operationId:"operation"}});
});
