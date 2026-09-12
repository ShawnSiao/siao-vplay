import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { previewAiSettings, previewNetworkSettings } from "./previewData";
import type { AiServiceSummary } from "./types";
import { useEnvironmentSettings } from "./useEnvironmentSettings";

const mocks = vi.hoisted(() => ({ read: vi.fn(), test: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("./gateway", async original => ({
  ...await original<typeof import("./gateway")>(),
  getAiServiceSettings: mocks.read,
  getNetworkSettings: vi.fn(async () => previewNetworkSettings),
  testAiService: mocks.test, saveAiService: mocks.save, deleteAiService: mocks.remove,
}));
const service: AiServiceSummary = {
  id: "saved-openai", providerId: "openai", displayName: "OpenAI", protocol: "openai_responses",
  baseUrl: "https://api.openai.com/v1", modelId: "saved-model", credentialState: "stored",
  connectionState: "ready", capabilities: { understanding: true, learning: true, vision: false },
  isDefault: false, revision: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ ...previewAiSettings, revision: 1, services: [service], defaultServiceId: null });
});
async function editedServices() {
  const hook = renderHook(() => useEnvironmentSettings(true, false));
  await waitFor(() => expect(hook.result.current.settings).not.toBeNull());
  act(() => hook.result.current.select("provider:deepseek"));
  act(() => hook.result.current.updateDraft({ modelId: "other-unsaved-model" }));
  act(() => hook.result.current.select(service.id));
  act(() => hook.result.current.updateDraft({ modelId: "unsaved-model", apiKey: "synthetic-replacement" }));
  return hook;
}

it.each(["test", "save", "remove"] as const)("keeps editable drafts after %s fails", async operation => {
  mocks[operation].mockRejectedValueOnce(new Error("operation unavailable"));
  const { result } = await editedServices();
  const draft = result.current.draft;
  await act(async () => result.current[operation]());
  expect(result.current.error).toBe("operation unavailable");
  expect(result.current.operation).toBeNull();
  expect(result.current.draft).toEqual(draft);
  expect(result.current.settings?.revision).toBe(1);
  act(() => result.current.select("provider:deepseek"));
  expect(result.current.draft?.modelId).toBe("other-unsaved-model");
  act(() => result.current.select(service.id));
  expect(result.current.draft).toEqual(draft);
  act(() => result.current.updateDraft({ modelId: "continued-edit" }));
  expect(result.current.draft?.modelId).toBe("continued-edit");
});

it("successful deletion clears only the deleted service draft", async () => {
  mocks.remove.mockResolvedValueOnce({ ...previewAiSettings, revision: 2, services: [], defaultServiceId: null });
  const { result } = await editedServices();
  await act(async () => result.current.remove());
  expect(mocks.remove).toHaveBeenCalledWith(1, service.id);
  expect(result.current.dirtySelectionIds).toEqual(["provider:deepseek"]);
  act(() => result.current.select("provider:deepseek"));
  expect(result.current.draft?.modelId).toBe("other-unsaved-model");
  act(() => result.current.select("provider:openai"));
  expect(result.current.draft?.apiKey).toBe("");
  expect(result.current.draft?.modelId).not.toBe("unsaved-model");
});
