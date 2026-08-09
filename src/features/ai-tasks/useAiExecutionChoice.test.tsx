import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiServiceSettings } from "../environment-settings/types";
import { useAiExecutionChoice } from "./useAiExecutionChoice";

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
