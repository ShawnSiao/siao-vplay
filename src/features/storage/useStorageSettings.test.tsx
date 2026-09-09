import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useStorageSettings } from "./useStorageSettings";
const gateway = vi.hoisted(() => ({ getStorageSettings: vi.fn(), getCurrentStorageMigration: vi.fn(), clearPlaybackCache: vi.fn(), saveStorageSettings: vi.fn() }));
vi.mock("./gateway", () => gateway);
beforeEach(() => { vi.resetAllMocks(); });
it("preserves unsaved default directories across page reactivation", async () => {
  const { result, rerender } = renderHook(({ active }) => useStorageSettings(active, true, vi.fn()), { initialProps: { active: true } });
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  await act(async () => { result.current.setSubtitleDirectory("W:/draft-subtitles"); result.current.setReportDirectory(null); });
  rerender({ active: false });
  rerender({ active: true });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(result.current.subtitleDirectory).toBe("W:/draft-subtitles");
  expect(result.current.reportDirectory).toBeNull();
});
it("clears playback cache without discarding default-directory edits", async () => {
  const { result } = renderHook(() => useStorageSettings(true, true, vi.fn()));
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  await act(async () => { result.current.setSubtitleDirectory("W:/draft-subtitles"); });
  await act(() => result.current.clearCache());
  expect(result.current.settings?.mediaCacheUsedBytes).toBe(0);
  expect(result.current.subtitleDirectory).toBe("W:/draft-subtitles");
});
it("saved defaults become the new refresh baseline", async () => {
  const { result } = renderHook(() => useStorageSettings(true, true, vi.fn()));
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  await act(async () => { result.current.setSubtitleDirectory("W:/saved-subtitles"); });
  await act(() => result.current.saveDefaults());
  expect(result.current.settings?.defaultSubtitleExportDirectory).toBe("W:/saved-subtitles");
  await act(async () => { result.current.setSubtitleDirectory("W:/new-draft"); });
  await act(() => result.current.clearCache());
  expect(result.current.subtitleDirectory).toBe("W:/new-draft");
});

async function realController() {
  const preview = renderHook(() => useStorageSettings(true, true, vi.fn()));
  await waitFor(() => expect(preview.result.current.settings).not.toBeNull());
  const settings = preview.result.current.settings!;
  preview.unmount();
  gateway.getStorageSettings.mockResolvedValue(settings);
  gateway.getCurrentStorageMigration.mockResolvedValue(null);
  const hook = renderHook(() => useStorageSettings(true, false, vi.fn()));
  await waitFor(() => expect(hook.result.current.settings).not.toBeNull());
  return { ...hook, settings };
}
it("retains editable defaults after a failed save", async () => {
  const { result } = await realController();
  gateway.saveStorageSettings.mockRejectedValue(new Error("保存失败"));
  await act(async () => result.current.setSubtitleDirectory("W:/draft"));
  await act(() => result.current.saveDefaults());
  expect(result.current.error).toBe("保存失败");
  expect(result.current.subtitleDirectory).toBe("W:/draft");
  expect(result.current.operation).toBeNull();
});
it.each(["W:/newer", null])("a save acknowledgement does not overwrite a newer edit %s", async newer => {
  const { result, settings } = await realController();
  let finish!: (value: typeof settings) => void;
  gateway.saveStorageSettings.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await act(async () => result.current.setSubtitleDirectory("W:/submitted"));
  let save!: Promise<void>;
  act(() => { save = result.current.saveDefaults(); });
  await act(async () => result.current.setSubtitleDirectory(newer));
  await act(async () => { finish({ ...settings, revision: settings.revision + 1, defaultSubtitleExportDirectory: "W:/submitted" }); await save; });
  expect(result.current.subtitleDirectory).toBe(newer);
  expect(result.current.settings?.defaultSubtitleExportDirectory).toBe("W:/submitted");
});
