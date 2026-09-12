import { beforeEach, expect, it, vi } from "vitest";
import { exportVideoSummary } from "./gateway";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const good = { summaryId: "summary", directory: "W:/reports/export", reportPath: "W:/reports/export/report.md", manifestPath: "W:/reports/export/manifest.json", assetCount: 2, reportSha256: "a".repeat(64) };
beforeEach(() => { invoke.mockReset(); });
it.each([null, {}, { ...good, summaryId: "other" }, { ...good, assetCount: -1 }, { ...good, assetCount: 1.5 }, { ...good, assetCount: 13 }, { ...good, reportSha256: "invalid" }, { ...good, directory: "W:/other/export" }, { ...good, reportPath: "W:/other/report.md" }, { ...good, manifestPath: "W:/other/manifest.json" }])("does not claim success from an invalid export receipt", async value => {
  invoke.mockResolvedValue(value);
  await expect(exportVideoSummary("summary", "W:/reports")).rejects.toThrow("保存结果尚未确认");
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("returns the validated receipt without repeating the committed operation", async () => {
  invoke.mockResolvedValue(good);
  await expect(exportVideoSummary("summary", "W:/reports")).resolves.toEqual(good);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("preserves backend failures without retrying", async () => {
  const error = { code: "validation_failed", message: "请选择已存在的报告保存目录" };
  invoke.mockRejectedValue(error);
  await expect(exportVideoSummary("summary", "W:/reports")).rejects.toMatchObject(error);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("accepts Windows separators and a trailing separator in the selected directory", async () => {
  const receipt = Object.fromEntries(Object.entries(good).map(([key, value]) => [key, typeof value === "string" ? value.replaceAll("/", "\\") : value]));
  invoke.mockResolvedValue(receipt);
  await expect(exportVideoSummary("summary", "W:/reports/")).resolves.toEqual(receipt);
});
