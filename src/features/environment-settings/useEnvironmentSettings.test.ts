import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEnvironmentSettings } from "./useEnvironmentSettings";

describe("AI service drafts", () => {
  it("keeps distinct unsaved drafts when switching providers and Codex", async () => {
    const { result } = renderHook(() => useEnvironmentSettings(true, true));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    act(() => result.current.select("provider:openai"));
    act(() => result.current.updateDraft({ apiKey: "temporary-test-key", modelId: "first-model" }));
    act(() => result.current.select("provider:deepseek"));
    act(() => result.current.updateDraft({ modelId: "second-model" }));
    act(() => result.current.select("local:codex"));
    act(() => result.current.select("provider:openai"));
    expect(result.current.draft?.modelId).toBe("first-model");
    expect(result.current.draft?.apiKey).toBe("temporary-test-key");
    act(() => result.current.select("provider:deepseek"));
    expect(result.current.draft?.modelId).toBe("second-model");
    expect(result.current.draft?.apiKey).toBe("");
  });
});
