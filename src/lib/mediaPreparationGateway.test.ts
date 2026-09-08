import schema from "../../contracts/media-preparation-progress.schema.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMediaPreparation } from "./mediaPreparationGateway";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
const valid = { requestId: "request-1", projectId: "project-1", stage: "transcode", status: "running" };
describe("media preparation IPC contract", () => {
  beforeEach(() => mocks.invoke.mockReset());
  it.each(schema.examples)("accepts the actual Rust serialization: %j", async (payload) => {
    mocks.invoke.mockResolvedValue(payload);
    expect(await getMediaPreparation(payload.requestId)).toEqual(payload);
  });
  it("retains a valid response and absent task", async () => {
    mocks.invoke.mockResolvedValueOnce(valid).mockResolvedValueOnce(null);
    expect(await getMediaPreparation("request-1")).toEqual(valid);
    expect(await getMediaPreparation("missing")).toBeNull();
  });
  it.each([
    { ...valid, stage: "upload" }, { ...valid, status: "finished" },
    { ...valid, projectId: 7 }, { requestId: "request-1" },
    { ...valid, requestId: "another-request" }, [], "running",
  ])("rejects malformed or unrelated task data: %j", async (payload) => {
    mocks.invoke.mockResolvedValue(payload);
    await expect(getMediaPreparation("request-1")).rejects.toThrow("视频准备状态格式无效");
  });
});
