import { beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { listSummaryActivity } from "./activityGateway";
const good = { id: "good", projectId: "project", projectTitle: "视频", status: "completed", hasResult: true, updatedAtMs: 1 };
beforeEach(() => invoke.mockReset());
it.each([null, { ...good, id: "bad", status: "unknown" }, { ...good, id: "bad", projectId: " " }, { ...good, id: "bad", projectTitle: "" }, { ...good, id: "bad", updatedAtMs: -1 }, { ...good, id: "bad", updatedAtMs: 1.5 }, { ...good, id: "bad", updatedAtMs: Number.MAX_SAFE_INTEGER + 1 }, { ...good, id: "bad", status: "running" }])("isolates invalid activity while retaining independently valid records", async invalid => {
  invoke.mockResolvedValue([invalid, good]);
  await expect(listSummaryActivity()).resolves.toEqual({ activities: [good], incomplete: true });
});
it("removes both records with an ambiguous task identity", async () => {
  invoke.mockResolvedValue([good, { ...good, projectId: "another-video" }, { ...good, id: "independent" }]);
  await expect(listSummaryActivity()).resolves.toEqual({ activities: [{ ...good, id: "independent" }], incomplete: true });
});
it("accepts unavailable results without claiming completion availability", async () => {
  const unavailable = { ...good, hasResult: false };
  invoke.mockResolvedValue([unavailable]);
  await expect(listSummaryActivity()).resolves.toEqual({ activities: [unavailable], incomplete: false });
});
it("rejects invalid or oversized envelopes", async () => {
  invoke.mockResolvedValueOnce(null).mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({ ...good, id: String(index) })));
  await expect(listSummaryActivity()).rejects.toThrow();
  await expect(listSummaryActivity()).rejects.toThrow();
});
