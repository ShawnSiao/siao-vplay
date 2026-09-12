import { beforeEach, expect, it, vi } from "vitest";
import { inspectLocalResourceBinding, retryLocalResourceBinding } from "./resourceLocationGateway";
import { locationResult } from "../test-fixtures/resourceLocation";
import { setupStatus } from "../test-fixtures/localResources";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() })); vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const value = locationResult({ ...setupStatus, configured: true, rootState: "ready", selectedParent: "W:/fixture", resourceRoot: "W:/fixture/SiaoVPlay" });
beforeEach(() => mocks.invoke.mockReset());
it.each([
  { bindingError: undefined }, { bindingError: " " }, { taskSnapshot: null },
  { bindingError: "failed" }, { configurationFingerprint: "" },
  { taskSnapshot: { generation: -1, tasks: [] } }, { taskSnapshot: { generation: 0, tasks: [] } },
])("rejects malformed or contradictory recovery results %#", async patch => {
  mocks.invoke.mockResolvedValue({ ...value, ...patch }); await expect(inspectLocalResourceBinding()).rejects.toThrow();
});
it("preserves failed retry acknowledgement", async () => {
  const failed = { ...value, bindingError: "file unavailable", taskSnapshot: null };
  mocks.invoke.mockResolvedValue(failed); await expect(retryLocalResourceBinding(failed)).resolves.toEqual(failed);
  expect(mocks.invoke).toHaveBeenCalledWith("retry_local_resource_binding", { input: { resourceRoot: value.resourceRoot, configurationFingerprint: value.configurationFingerprint } });
});
it("rejects a retry acknowledgement for another directory", async () => {
  mocks.invoke.mockResolvedValue({ ...value, selectedParent: "W:/other", resourceRoot: "W:/other/SiaoVPlay" });
  await expect(retryLocalResourceBinding(value)).rejects.toThrow();
});
