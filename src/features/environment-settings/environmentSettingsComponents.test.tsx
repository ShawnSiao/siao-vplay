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
    expect(screen.getByRole("button", { name: /OpenAI/ }).querySelector("img")).toBeTruthy();
    expect(screen.getByText("已连接 · 默认")).toBeVisible();
  });

  it("uses the contrast-safe brand tile for the original Kimi logo", () => {
    const kimiProvider = {
      ...provider,
      id: "kimi" as const,
      displayName: "Kimi",
      protocol: "openai_chat_completions" as const,
      officialBaseUrl: "https://api.moonshot.ai/v1",
    };
    const nextController = controller();
    nextController.settings = {
      ...settings,
      providerCatalog: { schemaVersion: 1, providers: [kimiProvider] },
      services: [],
      defaultServiceId: null,
    };
    nextController.selectionId = "provider:kimi";
    nextController.service = null;
    nextController.provider = kimiProvider;

    render(<AiServiceList controller={nextController} />);

    const logo = screen.getByRole("button", { name: /Kimi/ }).querySelector("img");
    expect(logo).toBeTruthy();
    expect(logo?.parentElement).toHaveAttribute("data-logo-provider", "kimi");
  });

  it("does not present stored credentials as a successful connection", () => {
    const untestedService = { ...service, connectionState: "untested" as const };
    const nextController = controller();
    nextController.settings = {
      ...settings,
      services: [untestedService],
    };
    nextController.service = untestedService;

    render(<AiServiceList controller={nextController} />);
    expect(screen.getByText("已配置，未测试 · 默认")).toBeVisible();
    expect(screen.queryByText("已保存 · 默认")).toBeNull();
  });
});
