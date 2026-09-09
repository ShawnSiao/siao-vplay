import { beforeEach, expect, it, vi } from "vitest";
import { getLocalResourceDiagnosticSummary, getLocalResourceThirdPartyNotices, openExternalResultDirectory } from "./desktop";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
for (const [name, read] of [["diagnostics", getLocalResourceDiagnosticSummary], ["notices", getLocalResourceThirdPartyNotices]] as const) {
  it.each([null, {}, 42, false])(`${name} rejects non-text %j`, async value => {
    mocks.invoke.mockResolvedValue(value);
    await expect(read()).rejects.toThrow();
  });
  it(`${name} preserves exact text`, async () => {
    const text = "第三方说明\nMIT\n";
    mocks.invoke.mockResolvedValue(text);
    await expect(read()).resolves.toBe(text);
  });
}
it.each([null, {}, 1, "false"])("rejects non-boolean directory response %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(openExternalResultDirectory("learning", "task")).rejects.toThrow();
});
it.each([true, false])("preserves directory response %s and task identity", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(openExternalResultDirectory("learning", "task")).resolves.toBe(value);
  expect(mocks.invoke).toHaveBeenCalledWith("open_external_result_directory", {taskKind:"learning", taskId:"task"});
});
