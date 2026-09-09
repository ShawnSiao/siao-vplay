import { beforeEach, expect, it, vi } from "vitest";
import { inspectYouTubeUrl, cancelYouTubeImport, getPublicResolverDisclosure } from "./publicVideoGateway";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => { mocks.invoke.mockReset(); });
const url = "https://www.youtube.com/watch?v=example";
const preview = { originalUrl: url, webpageUrl: url, videoId: "example", title: "Video", durationSeconds: 10.5,
  fileSizeBytes: null, importerVersion: "2026.09", importerSha256: "a".repeat(64), previewToken: "b".repeat(64) };
it.each([null, {}, { ...preview, originalUrl: "https://example.com/other" },
  { ...preview, webpageUrl: "file:///video" }, { ...preview, durationSeconds: 0 },
  { ...preview, durationSeconds: Infinity }, { ...preview, fileSizeBytes: -1 },
  { ...preview, fileSizeBytes: Number.MAX_SAFE_INTEGER + 1 }, { ...preview, videoId: " " },
  { ...preview, importerSha256: "invalid" }, { ...preview, previewToken: "invalid" }])("rejects invalid preview %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(inspectYouTubeUrl(url)).rejects.toThrow();
});
it("accepts preview without inventing file size or requiring same webpage URL", async () => {
  const value = { ...preview, webpageUrl: "https://example.com/canonical" };
  mocks.invoke.mockResolvedValue(value);
  await expect(inspectYouTubeUrl(url)).resolves.toEqual(value);
});
it("passes exact resolver consent and accepts URL normalization", async () => {
  mocks.invoke.mockResolvedValue(preview);
  await expect(inspectYouTubeUrl(` ${url} `, "https://resolver.example/status/")).resolves.toEqual(preview);
  expect(mocks.invoke).toHaveBeenCalledWith("inspect_youtube_url", {
    input: { url: ` ${url} ` }, authorizedResolverBase: "https://resolver.example/status/",
  });
});
it.each(["file:///video", "https://user:password@example.com/video"])("rejects invalid input before inspection %s", async value => {
  await expect(inspectYouTubeUrl(value)).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it.each([null, {}, 1, "false"])("rejects malformed cancellation %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(cancelYouTubeImport("operation")).rejects.toThrow();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it.each([false, true])("preserves cancellation %s", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(cancelYouTubeImport("operation")).resolves.toBe(value);
});
const disclosure = { receiver: "https://resolver.example", resolverBase: "https://resolver.example/status/" };
it.each([null, {}, { ...disclosure, receiver: "https://other.example" },
  { ...disclosure, resolverBase: "http://resolver.example/status/" },
  { ...disclosure, resolverBase: "https://user:password@resolver.example/status/" },
  { ...disclosure, resolverBase: "https://resolver.example/status/?secret=value" }])("rejects misleading disclosure %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getPublicResolverDisclosure()).rejects.toThrow();
});
it("preserves exact authorized resolver path", async () => {
  mocks.invoke.mockResolvedValue(disclosure);
  await expect(getPublicResolverDisclosure()).resolves.toEqual(disclosure);
});
