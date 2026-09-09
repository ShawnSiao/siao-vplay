import { beforeEach, expect, it, vi } from "vitest";
import { cancelStorageMigration, getCurrentStorageMigration, getStorageMigration, prepareStorageMigration, resumeStorageMigration, startStorageMigration } from "./gateway";
import { storageMigrationFixture as task } from "../../test-fixtures/storage";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => vi.resetAllMocks());
it.each([{}, { ...task, status: "unknown" }, { ...task, copiedBytes: -1 }, { ...task, fileCount: 1.5 }, { ...task, freeSpaceBytes: Number.MAX_SAFE_INTEGER + 1 }, { ...task, id: " " }])("rejects malformed current tasks", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getCurrentStorageMigration()).rejects.toThrow();
});
it("accepts no current migration", async () => {
  mocks.invoke.mockResolvedValue(null);
  await expect(getCurrentStorageMigration()).resolves.toBeNull();
});
it.each([getStorageMigration, startStorageMigration, resumeStorageMigration, cancelStorageMigration])("rejects another task without repeating the operation", async operation => {
  mocks.invoke.mockResolvedValue({ ...task, id: "other" });
  await expect(operation(task.id)).rejects.toThrow();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("rejects prepared task for a different area", async () => {
  mocks.invoke.mockResolvedValue({ ...task, status: "prepared", area: "app_data" });
  await expect(prepareStorageMigration("remote_media", "W:/new", "copy")).rejects.toThrow();
});
it("accepts canonicalized preparation paths and running cancellation acknowledgements", async () => {
  mocks.invoke.mockResolvedValue({ ...task, status: "prepared" });
  await expect(prepareStorageMigration("remote_media", "W:/alias", "copy")).resolves.toMatchObject({ destinationRoot: "W:/new" });
  mocks.invoke.mockResolvedValue({ ...task, status: "running" });
  await expect(cancelStorageMigration(task.id)).resolves.toMatchObject({ status: "running" });
});
