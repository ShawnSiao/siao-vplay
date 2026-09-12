import { afterAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => { Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} }); return { invoke: vi.fn() }; });
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { reconcileExternalAgentResults, acknowledgeExternalAgentResults } from "./desktop";
import type { ExternalAgentResultUpdate } from "../types";
const good: ExternalAgentResultUpdate = { taskKind: "translation", taskId: "task", projectId: "project", status: "completed", outputId: "version", message: "已导入" };
beforeEach(() => mocks.invoke.mockReset());
afterAll(() => Reflect.deleteProperty(window, "__TAURI_INTERNALS__"));
it.each([null, {}, { ...good, taskKind: "unknown" }, { ...good, status: "running" }, { ...good, outputId: null }, { ...good, taskId: " " }, { ...good, projectId: "" }, { ...good, status: "rejected" }, { ...good, message: 4 }])("isolates invalid updates and preserves independent valid results", async invalid => {
  mocks.invoke.mockResolvedValue([invalid, good]);
  await expect(reconcileExternalAgentResults()).resolves.toEqual([good]);
});
it("rejects a malformed envelope and a wholly invalid batch", async () => {
  mocks.invoke.mockResolvedValueOnce({ updates: [good] }).mockResolvedValueOnce([{}]);
  await expect(reconcileExternalAgentResults()).rejects.toThrow();
  await expect(reconcileExternalAgentResults()).rejects.toThrow();
});
it("refuses malformed completion acknowledgement before invoking", async () => {
  await expect(acknowledgeExternalAgentResults([{ ...good, outputId: null }])).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("acknowledges a detached snapshot and only completed results", async () => {
  const update = { ...good };
  const operation = acknowledgeExternalAgentResults([update, { ...good, status: "validating", outputId: null }]);
  update.outputId = "changed";
  await operation;
  expect(mocks.invoke).toHaveBeenCalledWith("acknowledge_external_agent_results", { updates: [good] });
});


it.each(["translation", "explanation", "learning"] as const)("accepts all valid notification states for %s", async taskKind => {
  const batch: ExternalAgentResultUpdate[] = ["validating", "completed", "rejected"].map(status => ({
    ...good, taskKind, status: status as ExternalAgentResultUpdate["status"], outputId: status === "completed" ? "version" : null,
  }));
  mocks.invoke.mockResolvedValue(batch);
  await expect(reconcileExternalAgentResults()).resolves.toEqual(batch);
});
it("accepts an empty scan and does not acknowledge noncompleted notifications", async () => {
  mocks.invoke.mockResolvedValue([]);
  await expect(reconcileExternalAgentResults()).resolves.toEqual([]);
  mocks.invoke.mockReset();
  await acknowledgeExternalAgentResults([{ ...good, status: "rejected", outputId: null }]);
  expect(mocks.invoke).not.toHaveBeenCalled();
});
