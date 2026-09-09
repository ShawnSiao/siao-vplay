import { beforeEach, expect, it, vi } from "vitest";
import { adoptLocalResources } from "./desktop";
import { resourceAdoptionPreview, resourceAdoptionResult } from "../test-fixtures/resourceAdoption";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() })); vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
const preview = { ...resourceAdoptionPreview, candidates: ["tool", "second", "third"].map(resourceId => ({ ...resourceAdoptionPreview.candidates[0], resourceId })), verifiedResourceIds: ["tool", "second", "third"], reusableBytes: 30 };
const interruption = { resourceId: "second", message: "安装确认失败", unattemptedResourceIds: ["third"] };
it("preserves completed adoption alongside an uncertain resource and unattempted resources", async () => {
  const value = { ...resourceAdoptionResult, interruption }; mocks.invoke.mockResolvedValue(value);
  await expect(adoptLocalResources(preview, "request-1")).resolves.toEqual(value);
});
it.each([
  { resourceId: "tool", message: "error", unattemptedResourceIds: [] },
  { resourceId: "unknown", message: "error", unattemptedResourceIds: [] },
  { resourceId: "second", message: "error", unattemptedResourceIds: ["third", "third"] },
])("rejects overlapping or invalid interrupted outcomes %#", async interruption => {
  mocks.invoke.mockResolvedValue({ ...resourceAdoptionResult, adoptedResourceIds: ["tool", "second", "third"], reusableBytes: 30, interruption });
  await expect(adoptLocalResources(preview, "request-1")).rejects.toThrow();
});

it.each([
  null,
  undefined,
  { resourceId: "second", message: "error", unattemptedResourceIds: [] },
  { resourceId: "second", message: "error", unattemptedResourceIds: ["unknown"] },
  { resourceId: "second", message: " ", unattemptedResourceIds: ["third"] },
])("rejects incomplete or malformed partial acknowledgement %#", async interruption => {
  mocks.invoke.mockResolvedValue({ ...resourceAdoptionResult, interruption });
  await expect(adoptLocalResources(preview, "request-1")).rejects.toThrow();
});
