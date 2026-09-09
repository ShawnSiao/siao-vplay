import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
import { readSubtitleMetadataPage } from "./subtitleMetadataPageGateway";
const item = { id: "v", trackId: "t", projectId: "p", role: "original", versionNumber: 1, status: "ready",
  sourceLabel: "字幕", languageCode: "en", createdAtMs: 1, isCurrent: true, segmentCount: 2 };
const page = { projectId: "p", offset: 0, totalCount: 2, nextOffset: 1, snapshotToken: "a".repeat(64), items: [item], currentVersions: [item] };
beforeEach(() => mocks.invoke.mockReset());
it.each([{}, { ...page, projectId: "other" }, { ...page, offset: 1 }, { ...page, nextOffset: 0 },
  { ...page, nextOffset: null }, { ...page, totalCount: -1 }, { ...page, snapshotToken: "x".repeat(64) },
  { ...page, items: [item, item], nextOffset: null }, { ...page, items: [{ ...item, projectId: "other" }] },
  { ...page, items: [{ ...item, segmentCount: -1 }] }, { ...page, items: [{ ...item, id: "" }] },
  { ...page, currentVersions: [{ ...item, isCurrent: false }] },
  { ...page, currentVersions: [{ ...item, projectId: "other" }] },
  { ...page, currentVersions: [item, item] }, { ...page, currentVersions: [] },
  { ...page, currentVersions: [{ ...item, segmentCount: 10 }] },
  { ...page, items: Array.from({ length: 25 }, (_, index) => ({ ...item, id: `v${index}` })), totalCount: 25, nextOffset: null },
].map(value => ({ value })))("rejects invalid or unrelated metadata pages", async ({ value }) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(readSubtitleMetadataPage("p", 0)).rejects.toThrow();
});
it("rejects invalid requests before dispatch", async () => {
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, 24]) {
    await expect(readSubtitleMetadataPage("p", offset)).rejects.toThrow();
  }
  await expect(readSubtitleMetadataPage("", 0)).rejects.toThrow();
  await expect(readSubtitleMetadataPage("p", 0, "wrong")).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("requires the confirmed snapshot and preserves continuation", async () => {
  mocks.invoke.mockResolvedValue(page);
  await expect(readSubtitleMetadataPage("p", 0, "b".repeat(64))).rejects.toThrow();
  const next = { ...page, offset: 1, nextOffset: null };
  mocks.invoke.mockResolvedValue(next);
  await expect(readSubtitleMetadataPage("p", 1, page.snapshotToken)).resolves.toEqual(next);
  expect(mocks.invoke).toHaveBeenLastCalledWith("list_subtitle_metadata_page", { input: { projectId: "p", offset: 1, expectedSnapshotToken: page.snapshotToken } });
});
it("accepts an empty end page", async () => {
  const end = { ...page, offset: 24, items: [], nextOffset: null };
  mocks.invoke.mockResolvedValue(end);
  await expect(readSubtitleMetadataPage("p", 24, page.snapshotToken)).resolves.toEqual(end);
});
