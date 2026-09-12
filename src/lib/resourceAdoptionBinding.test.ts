import { beforeEach, expect, it, vi } from "vitest";
import { adoptLocalResources, inspectLocalResourceMigration } from "./desktop";
import { resourceAdoptionPreview as preview, resourceAdoptionResult as result } from "../test-fixtures/resourceAdoption";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() })); vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
it.each([
  { ...result, planFingerprint: "b".repeat(64) }, { ...result, requestId: "other" }, { ...result, resourceRoot: "W:/other" },
  { ...result, adoptedResourceIds: ["other"] }, { ...result, adoptedResourceIds: [], reusableBytes: 0 },
  { ...result, rejectedResourceIds: ["unknown"] }, { ...result, reusableBytes: 11 },
])("rejects an adoption result unrelated to the confirmed candidates %#", async value => {
  mocks.invoke.mockResolvedValue(value); await expect(adoptLocalResources(preview, "request-1")).rejects.toThrow();
});
it("requires a fingerprint in migration previews", async () => {
  mocks.invoke.mockResolvedValue({ ...preview, planFingerprint: undefined }); await expect(inspectLocalResourceMigration("W:/source")).rejects.toThrow();
});

it("sends the confirmed source and target with the snapshot and request identity", async () => {
  mocks.invoke.mockResolvedValue(result); await expect(adoptLocalResources(preview, "request-1")).resolves.toEqual(result);
  expect(mocks.invoke).toHaveBeenCalledWith("adopt_local_resources", { input: { resourceRoot: preview.resourceRoot, sourcePath: "W:/source", sourceKind: "selected_directory", confirmed: true, planFingerprint: preview.planFingerprint }, requestId: "request-1" });
});
it("keeps nested confirmed candidates independent of caller changes", async () => {
  const selected = structuredClone(preview); let start!: () => void; const started = new Promise<void>(resolve => { start = resolve; });
  let finish!: (value: unknown) => void; const held = new Promise(resolve => { finish = resolve; });
  mocks.invoke.mockImplementation(() => { start(); return held; });
  const adopting = adoptLocalResources(selected, "request-1"); await started;
  selected.candidates[0].reusableBytes = 99; selected.sources[0].path = "W:/other"; selected.verifiedResourceIds.push("other");
  finish(result); await expect(adopting).resolves.toEqual(result);
});
it("does not dispatch adoption without a configured confirmed target", async () => {
  await expect(adoptLocalResources({ ...preview, resourceRoot: null }, "request-1")).rejects.toThrow(); expect(mocks.invoke).not.toHaveBeenCalled();
});
