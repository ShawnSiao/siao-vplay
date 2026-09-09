import { beforeEach, expect, it, vi } from "vitest";
import { listAnalysisPromptTemplates, saveAnalysisPromptTemplate } from "./gateway";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => { mocks.invoke.mockReset(); });
const row = { id: "custom", taskType: "summary", baseTemplateId: "base", name: "Name",
  customRequirements: "Details", isBuiltin: false, createdAtMs: 1, updatedAtMs: 2 };
const input = { id: "custom", taskType: "summary" as const, baseTemplateId: "base", name: " Name ", customRequirements: " Details " };
it.each([null, {}, [null], [row, row], [{ ...row, id: " " }], [{ ...row, createdAtMs: -1 }],
  [{ ...row, taskType: "unknown" }], [{ ...row, updatedAtMs: 0.5 }]].map(value => ({ value })))("rejects invalid lists $value", async ({ value }) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(listAnalysisPromptTemplates()).rejects.toThrow();
});
it("rejects a list for another task type", async () => {
  mocks.invoke.mockResolvedValue([row]);
  await expect(listAnalysisPromptTemplates("understanding")).rejects.toThrow();
});
it.each([[], [row], [row, { ...row, id: "builtin", isBuiltin: true, taskType: "understanding" }]].map(value => ({ value })))("accepts unfiltered lists $value", async ({ value }) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(listAnalysisPromptTemplates()).resolves.toEqual(value);
});
it.each([{}, { ...row, id: "other" }, { ...row, taskType: "understanding" },
  { ...row, baseTemplateId: "other" }, { ...row, isBuiltin: true }, { ...row, name: "other" },
  { ...row, customRequirements: "other" }])("rejects unconfirmed saved template %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(saveAnalysisPromptTemplate(input)).rejects.toThrow();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("accepts trimmed saved content and identity", async () => {
  mocks.invoke.mockResolvedValue(row);
  await expect(saveAnalysisPromptTemplate({ ...input, id: " custom " })).resolves.toEqual(row);
});
it("accepts backend assigned IDs for new templates", async () => {
  mocks.invoke.mockResolvedValue(row);
  await expect(saveAnalysisPromptTemplate({ ...input, id: null })).resolves.toEqual(row);
});
