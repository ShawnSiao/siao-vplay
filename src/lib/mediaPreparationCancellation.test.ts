import { beforeEach, expect, it, vi } from "vitest";
import { cancelMediaPreparation } from "./mediaPreparationGateway";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([null, {}, 1, "false"])("rejects malformed cancellation acknowledgement %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(cancelMediaPreparation("request")).rejects.toThrow();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it.each([true, false])("preserves cancellation result %s and request identity", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(cancelMediaPreparation("request")).resolves.toBe(value);
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_media_preparation", { requestId: "request" });
});
