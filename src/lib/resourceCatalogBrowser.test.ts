import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { getLocalResourceCatalog, getLocalResourceStatus } from "./desktop";
import schema from "../../contracts/local-resource-catalog.schema.json";

it("loads the validated shared catalogue and unconfigured status without native IPC", async () => {
  const catalog = await getLocalResourceCatalog();
  expect(catalog).toEqual(schema.examples[0]);
  const status = await getLocalResourceStatus();
  expect(status.configured).toBe(false);
  expect(status.capabilities.map(capability => capability.id)).toEqual(catalog.capabilities.map(capability => capability.id));
  expect(status.capabilities.every(capability => capability.state === "setup_required")).toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalled();
});
