import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { deleteProject } from "./desktop";
import { getPendingProjectCleanup } from "./projectDeletionGateway";
const result = { projectId: "project", deleted: true, sourceMediaDeleted: false, cachedMediaDeleted: false, cleanupPending: 1 };
beforeEach(() => mocks.invoke.mockReset());
it.each([{}, { projectId: " ", pendingDirectories: 1 }, { projectId: "id", pendingDirectories: 0 }, { projectId: "id", pendingDirectories: 1.5 }, { projectId: "id", pendingDirectories: -1 }, { projectId: "id", pendingDirectories: Number.MAX_SAFE_INTEGER + 1 }])("rejects invalid pending cleanup state", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getPendingProjectCleanup()).rejects.toThrow();
});
it("accepts empty and populated cleanup queues", async () => {
  const pending = { projectId: "id", pendingDirectories: 2 };
  mocks.invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(pending);
  await expect(getPendingProjectCleanup()).resolves.toBeNull();
  await expect(getPendingProjectCleanup()).resolves.toEqual(pending);
});
it.each([
  { ...result, projectId: "another" },
  { ...result, cleanupPending: -1 },
  { ...result, cleanupPending: 0.5 },
  { ...result, cleanupPending: Number.MAX_SAFE_INTEGER + 1 },
  { ...result, cleanupPending: undefined },
  { ...result, sourceMediaDeleted: true },
])("rejects invalid deletion receipt", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(deleteProject("project")).rejects.toThrow();
});
it("preserves pending cleanup and accepts a completed retry", async () => {
  mocks.invoke.mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, deleted: false, cleanupPending: 0 });
  await expect(deleteProject("project")).resolves.toEqual(result);
  await expect(deleteProject("project")).resolves.toEqual({ ...result, deleted: false, cleanupPending: 0 });
});
