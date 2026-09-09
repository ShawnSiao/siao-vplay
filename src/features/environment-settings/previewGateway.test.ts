import { beforeEach, expect, it, vi } from "vitest";
import { previewAiExecution } from "./gateway";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
beforeEach(() => { mocks.invoke.mockReset(); });
const execution = { kind: "api" as const, serviceConfigId: "service", modelId: "model" };
const authorization = { subtitles: true, currentQuestion: true, frames: false, serviceRevision: 7 };
const valid = { executionKind: "api", serviceConfigId: "service", providerId: "openai", displayName: "Test", modelId: "model", subtitles: true, currentQuestion: true, framesRequested: false, framesEffective: false, serviceRevision: 7 };

it.each([
  null, { executionKind: "api" }, { ...valid, executionKind: "other" },
  { ...valid, serviceConfigId: "other" }, { ...valid, modelId: "other" },
  { ...valid, serviceRevision: 8 }, { ...valid, serviceRevision: Number.MAX_SAFE_INTEGER + 1 },
  { ...valid, framesRequested: true }, { ...valid, framesEffective: true },
  { ...valid, subtitles: false }, { ...valid, currentQuestion: false },
])("rejects malformed or unrelated execution previews %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  await expect(previewAiExecution(execution, authorization)).rejects.toThrow("AI 执行预览与当前授权不一致");
});

it("allows a service to decline requested images without expanding scope", async () => {
  mocks.invoke.mockResolvedValue({ ...valid, framesRequested: true });
  expect((await previewAiExecution(execution, { ...authorization, frames: true })).framesEffective).toBe(false);
});

it.each(["manual", "codex"] as const)("accepts a local-client preview without API identity: %s", async (kind) => {
  const payload = { ...valid, executionKind: kind, serviceConfigId: null, providerId: null, modelId: null, serviceRevision: null };
  mocks.invoke.mockResolvedValue(payload);
  expect(await previewAiExecution({ kind }, { ...authorization, serviceRevision: null })).toEqual(payload);
});

it("rejects API identity attached to a local-client preview", async () => {
  mocks.invoke.mockResolvedValue({ ...valid, executionKind: "codex" });
  await expect(previewAiExecution({ kind: "codex" }, { ...authorization, serviceRevision: null })).rejects.toThrow("AI 执行预览与当前授权不一致");
});

it("compares the response with the request snapshot even if caller objects change", async () => {
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const target = { ...execution };
  const materials = { ...authorization };
  const response = previewAiExecution(target, materials);
  target.modelId = "changed";
  materials.frames = true;
  finish(valid);
  expect(await response).toEqual(valid);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("preview_ai_execution", { input: { execution, authorization } });
});
