import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiServiceSettings } from "../environment-settings/types";
import { useAiExecutionChoice } from "./useAiExecutionChoice";
import { publishAiServiceSettings } from "../environment-settings/events";

const gatewayMocks = vi.hoisted(() => ({
  getAiServiceSettings: vi.fn(),
  previewAiExecution: vi.fn(),
}));

vi.mock("../environment-settings/gateway", () => ({
  commandMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
  getAiServiceSettings: gatewayMocks.getAiServiceSettings,
  previewAiExecution: gatewayMocks.previewAiExecution,
}));

const services: AiServiceSettings["services"] = [
  { id: "default", providerId: "openai", displayName: "OpenAI", protocol: "openai_responses", baseUrl: "https://api.openai.com/v1", modelId: "model-a", credentialState: "stored", connectionState: "ready", capabilities: { understanding: true, learning: true, vision: true }, isDefault: true, revision: 3 },
  { id: "second", providerId: "deepseek", displayName: "DeepSeek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com", modelId: "model-b", credentialState: "stored", connectionState: "ready", capabilities: { understanding: true, learning: true, vision: false }, isDefault: false, revision: 1 },
];

const settings: AiServiceSettings = {
  schemaVersion: 1,
  revision: 5,
  providerCatalog: { schemaVersion: 1, providers: [] },
  services,
  defaultServiceId: "default",
};

describe("useAiExecutionChoice", () => {
  beforeEach(() => {
    gatewayMocks.getAiServiceSettings.mockResolvedValue(settings);
    gatewayMocks.previewAiExecution.mockResolvedValue({ executionKind: "api", serviceConfigId: "default", providerId: "openai", displayName: "OpenAI", modelId: "model-a", subtitles: true, currentQuestion: true, framesRequested: false, framesEffective: false, serviceRevision: 3 });
  });

  it("preselects the default service without preauthorizing frames", async () => {
    const { result } = renderHook(() => useAiExecutionChoice(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kind).toBe("api");
    expect(result.current.serviceId).toBe("default");
    expect(result.current.frames).toBe(false);
    expect(result.current.execution).toEqual({ kind: "api", serviceConfigId: "default", modelId: "model-a" });
  });

  it("uses a newly saved service without reopening the current task", async () => {
    gatewayMocks.previewAiExecution.mockClear();
    gatewayMocks.getAiServiceSettings.mockResolvedValueOnce({ ...settings, services: [], defaultServiceId: null });
    const { result } = renderHook(() => useAiExecutionChoice(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.services).toHaveLength(0);
    act(() => publishAiServiceSettings(settings));
    expect(result.current.services).toHaveLength(2);
    act(() => result.current.setKind("api"));
    expect(result.current.execution).toEqual({ kind: "api", serviceConfigId: "default", modelId: "model-a" });
    expect(gatewayMocks.previewAiExecution).not.toHaveBeenCalled();
  });

  it("preserves the explicit service and model but clears frame authorization after a save", async () => {
    const { result } = renderHook(() => useAiExecutionChoice(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.selectService("second"); result.current.setModelId("custom-model"); result.current.setFrames(true); });
    act(() => publishAiServiceSettings({ ...settings, revision: 6 }));
    expect(result.current.execution).toEqual({ kind: "api", serviceConfigId: "second", modelId: "custom-model" });
    expect(result.current.frames).toBe(false);
    act(() => publishAiServiceSettings({ ...settings, revision: 7, services: [services[0]] }));
    expect(result.current.execution).toBeNull();
  });

  it("does not let an older initial read overwrite newly saved services", async () => {
    let resolve!: (value: AiServiceSettings) => void;
    gatewayMocks.getAiServiceSettings.mockReturnValueOnce(new Promise<AiServiceSettings>(done => { resolve = done; }));
    const { result } = renderHook(() => useAiExecutionChoice(false));
    act(() => publishAiServiceSettings(settings));
    await act(async () => resolve({ ...settings, services: [], defaultServiceId: null }));
    expect(result.current.services).toHaveLength(2);
    expect(result.current.loading).toBe(false);
  });

  it("allows a one-task service and model switch", async () => {
    const { result } = renderHook(() => useAiExecutionChoice(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.selectService("second");
      result.current.setModelId("temporary-model");
    });
    expect(result.current.execution).toEqual({ kind: "api", serviceConfigId: "second", modelId: "temporary-model" });
    await act(() => result.current.preview());
    expect(gatewayMocks.previewAiExecution).toHaveBeenCalledWith(
      { kind: "api", serviceConfigId: "second", modelId: "temporary-model" },
      expect.objectContaining({ frames: false, serviceRevision: 1 }),
    );
  });

  it("keeps the selected provider after an error instead of falling back", async () => {
    gatewayMocks.previewAiExecution.mockRejectedValueOnce(new Error("请求超时"));
    const { result } = renderHook(() => useAiExecutionChoice(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await expect(result.current.preview()).rejects.toThrow("请求超时"); });
    expect(result.current.kind).toBe("api");
    expect(result.current.serviceId).toBe("default");
    expect(result.current.error).toBe("请求超时");
  });
});


it("restores a manual draft without replacing it with the default API", async () => {
  gatewayMocks.getAiServiceSettings.mockResolvedValue(settings);
  const { result } = renderHook(() => useAiExecutionChoice(false, { kind: "manual", serviceId: null, modelId: "" }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.kind).toBe("manual");
  expect(result.current.frames).toBe(false);
});
it("requires a new choice when a draft's saved service is no longer available", async () => {
  gatewayMocks.getAiServiceSettings.mockResolvedValue(settings);
  const { result } = renderHook(() => useAiExecutionChoice(false, { kind: "api", serviceId: "removed", modelId: "saved-model" }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.service).toBeNull();
  expect(result.current.serviceId).toBe("removed");
  expect(result.current.execution).toBeNull();
  await expect(result.current.preview()).rejects.toThrow("选择");
});
