import { beforeEach, expect, it, vi } from "vitest";
import { deleteAiService, getAiServiceSettings, saveAiService, setDefaultAiService, testAiService } from "./gateway";
import { previewAiSettings } from "./previewData";
import settingsSchema from "../../../contracts/ai-service-settings.schema.json";
import resultSchema from "../../../contracts/ai-service-test-result.schema.json";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEnvironmentSettings } from "./useEnvironmentSettings";
import { useAiExecutionChoice } from "../ai-tasks/useAiExecutionChoice";
import { previewNetworkSettings } from "./previewData";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
beforeEach(() => { mocks.invoke.mockReset(); });
const draft = { id: null, providerId: "openai" as const, displayName: "Test", protocol: "openai_responses" as const, baseUrl: "", modelId: "model", apiKey: "", makeDefault: false };
const input = { serviceConfigId: "service", providerId: draft.providerId, protocol: draft.protocol, baseUrl: null, modelId: "model", apiKey: null };

it("updates an open task through the validated save gateway", async () => {
  const saved = settingsSchema.examples.find(value => value.services.length > 0)!;
  mocks.invoke.mockResolvedValue({ ...saved, services: [], defaultServiceId: null });
  const { result } = renderHook(() => useAiExecutionChoice(false));
  await waitFor(() => expect(result.current.loading).toBe(false));
  mocks.invoke.mockResolvedValue(saved);
  await act(async () => { await saveAiService(0, draft); });
  expect(result.current.settings).toEqual(saved);
  mocks.invoke.mockResolvedValue({ services: [] });
  await act(async () => { await expect(saveAiService(saved.revision, draft)).rejects.toThrow(); });
  expect(result.current.settings).toEqual(saved);
});

it.each(settingsSchema.examples)("accepts actual Rust service settings %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  expect(await getAiServiceSettings()).toEqual(payload);
  expect(await saveAiService(7, draft)).toEqual(payload);
  expect(await deleteAiService(7, "service")).toEqual(payload);
  expect(await setDefaultAiService(7, null)).toEqual(payload);
});

it.each(resultSchema.examples)("accepts actual Rust connection results %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  expect(await testAiService(input)).toEqual(payload);
});

it("keeps the service draft editable when a save returns malformed settings", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_ai_service_settings") return previewAiSettings;
    if (command === "get_network_settings") return previewNetworkSettings;
    if (command === "save_ai_service") return { services: [] };
    throw new Error(`Unexpected command ${command}`);
  });
  const { result } = renderHook(() => useEnvironmentSettings(true, false));
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  act(() => result.current.select("provider:openai"));
  act(() => result.current.updateDraft({ modelId: "edited-model" }));
  await act(async () => result.current.save());
  expect(result.current.error).toBe("AI 服务设置格式无效");
  expect(result.current.draft?.modelId).toBe("edited-model");
  expect(result.current.operation).toBeNull();
  expect(result.current.settings).toEqual(previewAiSettings);
  act(() => result.current.updateDraft({ modelId: "still-editable" }));
  expect(result.current.draft?.modelId).toBe("still-editable");
});

it.each([
  null, { services: [], defaultServiceId: null },
  { ...previewAiSettings, revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...previewAiSettings, defaultServiceId: 42 },
  { ...previewAiSettings, services: [{ id: "incomplete" }] },
])("rejects malformed configuration after every settings operation %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  for (const operation of [() => getAiServiceSettings(), () => saveAiService(0, draft), () => deleteAiService(0, "service"), () => setDefaultAiService(0, null)]) {
    await expect(operation()).rejects.toThrow("AI 服务设置格式无效");
  }
});

it.each([
  null, { state: "ready" },
  { state: "unknown", models: [], selectedModelId: null, capabilities: { understanding: true, learning: true, vision: false }, minimalRequestUsed: false, mayIncurUsage: false, providerRequestId: null },
])("rejects malformed connection-test results %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  await expect(testAiService(input)).rejects.toThrow("连接测试结果格式无效");
});
