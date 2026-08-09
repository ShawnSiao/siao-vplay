import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiServiceEditor } from "./AiServiceEditor";
import { AiServiceList } from "./AiServiceList";
import type { AiServiceSettings } from "./types";
import type { EnvironmentSettingsController } from "./useEnvironmentSettings";

const provider = { id: "openai" as const, displayName: "OpenAI", protocol: "openai_responses" as const, officialBaseUrl: "https://api.openai.com/v1", modelsPath: "/models", documentationUrl: null, supportsModelDiscovery: true, visionModelPrefixes: [] };
const service = { id: "openai-main", providerId: "openai" as const, displayName: "OpenAI", protocol: "openai_responses" as const, baseUrl: "https://api.openai.com/v1", modelId: "model-a", credentialState: "stored" as const, connectionState: "ready" as const, capabilities: { understanding: true, learning: true, vision: false }, isDefault: true, revision: 2 };
const settings: AiServiceSettings = {
  schemaVersion: 1,
  revision: 2,
  providerCatalog: { schemaVersion: 1, providers: [provider] },
  services: [service],
  defaultServiceId: service.id,
};

function controller(): EnvironmentSettingsController {
  return {
    settings,
    network: null,
    selectionId: service.id,
    draft: { id: service.id, providerId: "openai", displayName: "OpenAI", protocol: "openai_responses", baseUrl: service.baseUrl, modelId: "model-a", apiKey: "", makeDefault: true },
    models: [],
    testResult: null,
    operation: null,
    error: null,
    service,
    provider,
    select: vi.fn(),
    updateDraft: vi.fn(),
    refreshModels: vi.fn(),
    test: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    saveProxy: vi.fn(),
    clearError: vi.fn(),
  };
}

describe("environment settings components", () => {
  it("replaces a saved API key inline without exposing the old secret", () => {
    render(<AiServiceEditor controller={controller()} />);
    expect(screen.getByLabelText("API Key 已安全保存")).toHaveValue("••••••••••••••••••••••••");
    fireEvent.click(screen.getByRole("button", { name: "更换" }));
    expect(screen.getByPlaceholderText("输入新的 API Key")).toHaveAttribute("type", "password");
    expect(screen.getByRole("heading", { name: "OpenAI" })).toBeInTheDocument();
    expect(screen.queryByText("添加 AI 服务")).toBeNull();
  });

  it("renders each provider once in the left list", () => {
    render(<AiServiceList controller={controller()} />);
    expect(screen.getAllByRole("button", { name: /OpenAI/ })).toHaveLength(1);
    expect(screen.getAllByText("OpenAI")).toHaveLength(1);
  });
});
