import { beforeEach, expect, it, vi } from "vitest";
import { configureLocalResourceRoot } from "./resourceStatusGateway";
import { setupStatus } from "../test-fixtures/localResources";
import { resourceLocationPlan as plan } from "../test-fixtures/resourceLocation";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
it("rejects an acknowledgement for a different root", async () => {
  mocks.invoke.mockResolvedValue({ ...setupStatus, configured: true, rootState: "ready", selectedParent: "W:/other", resourceRoot: "W:/other/SiaoVPlay" });
  await expect(configureLocalResourceRoot(plan)).rejects.toThrow();
});
it("rejects malformed confirmation before IPC", async () => {
  await expect(configureLocalResourceRoot({ ...plan, planFingerprint: "" })).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("binds the immutable reviewed location to the request and acknowledgement", async () => {
  const selected = { ...plan };
  const status = { ...setupStatus, configured: true, rootState: "ready", selectedParent: plan.selectedParent, resourceRoot: plan.resourceRoot };
  mocks.invoke.mockResolvedValue(status);
  const operation = configureLocalResourceRoot(selected);
  selected.resourceRoot = "W:/changed"; selected.planFingerprint = "b".repeat(64);
  await expect(operation).resolves.toEqual(status);
  expect(mocks.invoke).toHaveBeenCalledWith("configure_local_resource_root", { input: {
    parentPath: plan.selectedParent, resourceRoot: plan.resourceRoot, planFingerprint: plan.planFingerprint, confirmed: true,
  } });
});
