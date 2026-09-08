import { beforeEach, expect, it, vi } from "vitest";
import schema from "../../contracts/subtitle-version-metadata.schema.json";
import { listSubtitleVersionMetadata, listSubtitleVersions, reviseSubtitleVersion } from "./subtitleGateway";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
beforeEach(() => mocks.invoke.mockReset());

it("reads metadata separately from the selected subtitle bodies", async () => {
  mocks.invoke.mockResolvedValue(schema.examples);
  expect(await listSubtitleVersionMetadata("p")).toEqual(schema.examples);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("list_subtitle_version_metadata", { projectId: "p" });
  mocks.invoke.mockClear();
  mocks.invoke.mockResolvedValue([]);
  await listSubtitleVersions("p", false);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("list_subtitle_versions", { projectId: "p", includeHistory: false });
});

it("rejects a full subtitle body accidentally returned by the metadata endpoint", async () => {
  mocks.invoke.mockResolvedValue([{ ...schema.examples[0], segments: [] }]);
  await expect(listSubtitleVersionMetadata("p")).rejects.toThrow("字幕版本列表格式无效");
});

it("preserves optimistic revision identity across the gateway", async () => {
  mocks.invoke.mockResolvedValue({ id: "new-draft" });
  expect(await reviseSubtitleVersion("p", "base", 7)).toEqual({ id: "new-draft" });
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("revise_subtitle_version", {
    input: { projectId: "p", baseVersionId: "base", expectedProjectRevision: 7, segmentEdits: [], globalReplacement: null, offsetMs: 0 },
  });
});
