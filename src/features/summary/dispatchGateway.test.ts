import { beforeEach, expect, it, vi } from "vitest";
import { previewSummaryDispatch } from "./dispatchGateway";
import { summaryDispatchFixture } from "../../test-fixtures/summaryDispatch";
import schema from "../../../contracts/summary-dispatch-preview.schema.json";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
beforeEach(() => { mocks.invoke.mockReset(); });

it("accepts actual Rust summary serialization with full frame metadata", async () => {
  mocks.invoke.mockResolvedValue(schema.examples[0]);
  expect(await previewSummaryDispatch("summary-task-1")).toEqual(schema.examples[0]);
});

it.each(["bad-frame-hash", "future-frame", "bad-endpoint", "missing-template", "zero-version", "reversed-range"])("rejects malformed summary material: %s", async (scenario) => {
  const preview = summaryDispatchFixture();
  const frame = { id: "frame", ordinal: 0, relativePath: "input/frames/frame.jpg", timestampMs: 1000, sha256: "a".repeat(64) };
  if (scenario === "bad-frame-hash") preview.frames = [{ ...frame, sha256: "bad" }];
  if (scenario === "future-frame") preview.frames = [{ ...frame, timestampMs: 16000 }];
  if (scenario === "bad-endpoint") Object.assign(preview, { endpoint: 1 });
  if (scenario === "missing-template") Object.assign(preview, { promptTemplate: undefined });
  if (scenario === "zero-version") preview.subtitleVersionNumber = 0;
  if (scenario === "reversed-range") { preview.firstStartMs = 20000; preview.lastEndMs = 10000; }
  mocks.invoke.mockResolvedValue(preview);
  await expect(previewSummaryDispatch(preview.taskId)).rejects.toThrow("总结发送清单无效");
});

it("retains the full subtitle crossing the current cutoff", async () => {
  const preview = summaryDispatchFixture();
  mocks.invoke.mockResolvedValue(preview);
  expect(await previewSummaryDispatch(preview.taskId)).toEqual(preview);
});
