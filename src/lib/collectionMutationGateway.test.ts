import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { createCollection, updateCollection, deleteCollection } from "../features/library/libraryGateway";
import { collection } from "../features/library/libraryControllerTestFixtures";
beforeEach(() => mocks.invoke.mockReset());
it.each([{}, { ...collection, id: " " }, { ...collection, kind: "unknown" }])("rejects invalid created collections", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(createCollection({ title: "新合集" })).rejects.toThrow();
});
it("rejects another collection returned by update", async () => {
  mocks.invoke.mockResolvedValue({ ...collection, id: "other" });
  await expect(updateCollection({ collectionId: collection.id, title: "新名称" })).rejects.toThrow();
});
it.each([
  {}, { collectionId: "other", rootId: null, rootStatus: null, preservedProjectCount: 0 },
  { collectionId: collection.id, rootId: null, rootStatus: null, preservedProjectCount: -1 },
  { collectionId: collection.id, rootId: "root", rootStatus: null, preservedProjectCount: 1 },
])("rejects invalid deletion receipts", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(deleteCollection(collection.id)).rejects.toThrow();
});
it("accepts created/updated collections and deletion with preserved projects", async () => {
  mocks.invoke.mockResolvedValueOnce(collection).mockResolvedValueOnce(collection);
  await expect(createCollection({ title: collection.title })).resolves.toEqual(collection);
  await expect(updateCollection({ collectionId: collection.id })).resolves.toEqual(collection);
  const receipt = { collectionId: collection.id, rootId: "root", rootStatus: "orphaned", preservedProjectCount: 2 };
  mocks.invoke.mockResolvedValue(receipt);
  await expect(deleteCollection(collection.id)).resolves.toEqual(receipt);
});
