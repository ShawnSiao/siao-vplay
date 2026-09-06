import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { executionForTask, useAiExecutionChoice } from "./useAiExecutionChoice";
vi.mock("../environment-settings/gateway", () => ({
  getAiServiceSettings: vi.fn().mockResolvedValue({ services: [], defaultServiceId: null }),
  commandMessage: String, previewAiExecution: vi.fn(),
}));
describe("AI material consent", () => {
  it("requires a fresh frame opt-in when changing execution method", async () => {
    const { result } = renderHook(() => useAiExecutionChoice(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.frames).toBe(false);
    act(() => result.current.setFrames(true));
    expect(result.current.authorization.frames).toBe(true);
    act(() => result.current.setKind("manual"));
    expect(result.current.frames).toBe(false);
    act(() => result.current.setKind("codex"));
    expect(result.current.frames).toBe(false);
  });
  it("does not silently redirect an incomplete API task to Codex", () => {
    expect(() => executionForTask(undefined, "api")).toThrow();
    expect(() => executionForTask({ kind: "api" } as Parameters<typeof executionForTask>[0], "api")).toThrow();
    expect(executionForTask(undefined, "manual")).toEqual({ kind: "manual" });
  });
});
