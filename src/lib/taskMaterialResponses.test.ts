import { beforeEach, expect, it, vi } from "vitest";
import { readExplanationPrompt, openExplanationMaterials } from "./explanationGateway";
import { readLearningPrompt } from "./learningGateway";
import { readTranslationPrompt } from "./translationGateway";
import { openSummaryMaterials } from "../features/summary/gateway";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => { mocks.invoke.mockReset(); });
for (const [command, read, nested] of [
  ["read_explanation_prompt", readExplanationPrompt, false],
  ["read_learning_prompt", readLearningPrompt, false],
  ["read_translation_prompt", readTranslationPrompt, true],
] as const) {
  it.each([null, {}, false, 1])(`${command} rejects non-text %j`, async value => {
    mocks.invoke.mockResolvedValue(value);
    await expect(read("task")).rejects.toThrow();
  });
  it(`${command} preserves exact content and task identity`, async () => {
    const text = " 提示词\n原文 🐱\n";
    mocks.invoke.mockResolvedValue(text);
    await expect(read("task")).resolves.toBe(text);
    expect(mocks.invoke).toHaveBeenCalledWith(command, nested ? { input: { taskId: "task" } } : { taskId: "task" });
  });
}
for (const open of [openExplanationMaterials, openSummaryMaterials]) {
  it.each([null, {}, 0, "false"])("rejects malformed open acknowledgement %j", async value => {
    mocks.invoke.mockResolvedValue(value);
    await expect(open("task")).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("preserves open acknowledgement %s", async value => {
    mocks.invoke.mockResolvedValue(value);
    await expect(open("task")).resolves.toBe(value);
  });
}
