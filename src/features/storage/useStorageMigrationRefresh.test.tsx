import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useStorageSettings } from "./useStorageSettings";
import { storageSettingsFixture as settings } from "../../test-fixtures/storage";
import { storageMigrationFixture as migration } from "../../test-fixtures/storage";
const gateway = vi.hoisted(() => ({ getStorageSettings: vi.fn(), getCurrentStorageMigration: vi.fn() }));
vi.mock("./gateway", () => gateway);

beforeEach(() => { vi.resetAllMocks(); gateway.getCurrentStorageMigration.mockResolvedValue(migration); });
it("exposes a failed post-migration read and permits read-only recovery", async () => {
  gateway.getStorageSettings.mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error("刷新失败")).mockResolvedValue({ ...settings, revision: 2 });
  const notice = vi.fn();
  const { result } = renderHook(() => useStorageSettings(true, false, notice));
  await waitFor(() => expect(result.current.error).toContain("刷新失败"));
  expect(result.current.migration?.status).toBe("completed");
  expect(result.current.settings?.revision).toBe(1);
  await act(() => result.current.reload());
  expect(result.current.error).toBeNull();
  expect(result.current.settings?.revision).toBe(2);
  expect(notice).toHaveBeenCalledTimes(1);
});

it("does not apply an older completion refresh after a newer explicit read", async () => {
  let finish!: (value: typeof settings) => void;
  gateway.getStorageSettings.mockResolvedValueOnce(settings).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ...settings, revision: 3 });
  const notice = vi.fn();
  const { result } = renderHook(() => useStorageSettings(true, false, notice));
  await waitFor(() => expect(gateway.getStorageSettings).toHaveBeenCalledTimes(2));
  await act(() => result.current.reload());
  await act(async () => { finish({ ...settings, revision: 2 }); });
  expect(result.current.settings?.revision).toBe(3);
});
it("announces a different completed migration even when the status string is unchanged", async () => {
  gateway.getStorageSettings.mockResolvedValue(settings);
  const notice = vi.fn();
  const { result } = renderHook(() => useStorageSettings(true, false, notice));
  await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
  gateway.getCurrentStorageMigration.mockResolvedValue({ ...migration, id: "another-migration" });
  await act(() => result.current.reload());
  await waitFor(() => expect(notice).toHaveBeenCalledTimes(2));
});
