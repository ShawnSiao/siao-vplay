import { beforeEach, expect, it, vi } from "vitest";
import { listAiServiceModels } from "./gateway";
import schema from "../../../contracts/ai-model-list.schema.json";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEnvironmentSettings } from "./useEnvironmentSettings";
import { previewAiSettings, previewNetworkSettings } from "./previewData";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
const input = { serviceConfigId: "service", providerId: "openai" as const, protocol: "openai_responses" as const, baseUrl: null, modelId: null, apiKey: null };
beforeEach(() => { mocks.invoke.mockReset(); });

it.each(schema.examples)("accepts actual Rust model serialization %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  expect(await listAiServiceModels(input)).toEqual(payload);
});

it.each([
  null, [], { models: [], manualEntryAllowed: "true" },
  { models: [{ id: "model", displayName: "Model", vision: "false", capabilitySource: "provider" }], manualEntryAllowed: true },
  { models: [{ id: "model" }], manualEntryAllowed: true },
])("rejects malformed model discovery output %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  await expect(listAiServiceModels(input)).rejects.toThrow("模型列表格式无效");
});

it("accepts an empty discovery list with manual model entry", async () => {
  const payload = { models: [], manualEntryAllowed: true };
  mocks.invoke.mockResolvedValue(payload);
  expect(await listAiServiceModels(input)).toEqual(payload);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("list_ai_service_models", { input });
});

it("preserves the edited model and permits retry after invalid discovery data", async () => {
  let malformed = true;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_ai_service_settings") return previewAiSettings;
    if (command === "get_network_settings") return previewNetworkSettings;
    if (command === "list_ai_service_models") return malformed ? { models: null } : schema.examples[1];
    throw new Error(`Unexpected command ${command}`);
  });
  const { result } = renderHook(() => useEnvironmentSettings(true, false));
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  act(() => result.current.select("provider:openai"));
  act(() => result.current.updateDraft({ modelId: "my-edited-model" }));
  await act(async () => result.current.refreshModels());
  expect(result.current.error).toBe("模型列表格式无效");
  expect(result.current.operation).toBeNull();
  expect(result.current.draft?.modelId).toBe("my-edited-model");
  malformed = false;
  await act(async () => result.current.refreshModels());
  expect(result.current.error).toBeNull();
  expect(result.current.models[0]?.id).toBe("model");
  expect(result.current.draft?.modelId).toBe("my-edited-model");
});
