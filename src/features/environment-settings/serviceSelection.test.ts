import { describe, expect, it } from "vitest";

import { draftForSelection, initialSelection, providerSelectionId } from "./serviceSelection";
import type { AiServiceSettings } from "./types";

const settings: AiServiceSettings = {
  schemaVersion: 1,
  revision: 4,
  providerCatalog: {
    schemaVersion: 1,
    providers: [
      { id: "openai", displayName: "OpenAI", protocol: "openai_responses", officialBaseUrl: "https://api.openai.com/v1", modelsPath: "/models", documentationUrl: null, supportsModelDiscovery: true, visionModelPrefixes: [] },
      { id: "custom", displayName: "其他兼容服务", protocol: "openai_chat_completions", officialBaseUrl: null, modelsPath: "/models", documentationUrl: null, supportsModelDiscovery: true, visionModelPrefixes: [] },
    ],
  },
  services: [{
    id: "openai-main",
    providerId: "openai",
    displayName: "OpenAI",
    protocol: "openai_responses",
    baseUrl: "https://api.openai.com/v1",
    modelId: "current-model",
    credentialState: "stored",
    connectionState: "ready",
    capabilities: { understanding: true, learning: true, vision: false },
    isDefault: true,
    revision: 2,
  }],
  defaultServiceId: "openai-main",
};

describe("AI service selection", () => {
  it("opens the configured default service", () => {
    expect(initialSelection(settings)).toBe("openai-main");
  });

  it("never returns the stored API key to the editor", () => {
    expect(draftForSelection(settings, "openai-main")).toMatchObject({
      id: "openai-main",
      modelId: "current-model",
      apiKey: "",
    });
  });

  it("does not hardcode a model for a new service", () => {
    expect(draftForSelection(settings, providerSelectionId("custom"))).toMatchObject({
      id: null,
      modelId: "",
      baseUrl: "",
    });
  });
});
