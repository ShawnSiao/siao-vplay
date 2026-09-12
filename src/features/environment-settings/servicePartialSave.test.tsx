import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { previewAiSettings, previewNetworkSettings } from "./previewData";
import { useEnvironmentSettings } from "./useEnvironmentSettings";
const mocks = vi.hoisted(() => ({ save: vi.fn(), defaults: vi.fn() }));
vi.mock("./gateway", async original => ({
  ...await original<typeof import("./gateway")>(),
  getAiServiceSettings: vi.fn(async () => ({ ...previewAiSettings, revision: 1, services: [], defaultServiceId: null })),
  getNetworkSettings: vi.fn(async () => previewNetworkSettings),
  saveAiService: mocks.save, setDefaultAiService: mocks.defaults,
}));
it("adopts a saved service identity and revision when setting default fails", async () => {
  const { result } = renderHook(() => useEnvironmentSettings(true, false));
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  act(() => result.current.select("provider:openai"));
  act(() => result.current.updateDraft({ modelId: "test-model", makeDefault: true, apiKey: "test-only-placeholder" }));
  const draft = result.current.draft!;
  const saved = { ...draft, id: "saved-service", isDefault: false };
  mocks.save.mockResolvedValueOnce({ ...previewAiSettings, revision: 2, services: [saved], defaultServiceId: null })
    .mockResolvedValueOnce({ ...previewAiSettings, revision: 3, services: [saved], defaultServiceId: null });
  mocks.defaults.mockRejectedValueOnce(new Error("default update failed"))
    .mockResolvedValueOnce({ ...previewAiSettings, revision: 4, services: [{ ...saved, isDefault: true }], defaultServiceId: saved.id });
  await act(async () => result.current.save());
  expect(result.current.settings?.revision).toBe(2);
  expect(result.current.draft?.id).toBe("saved-service");
  expect(result.current.draft?.makeDefault).toBe(true);
  expect(result.current.draft?.apiKey).toBe("");
  expect(result.current.dirtySelectionIds).toEqual([saved.id]);
  await act(async () => result.current.save());
  expect(mocks.save.mock.calls[1][0]).toBe(2);
  expect(mocks.save.mock.calls[1][1].id).toBe("saved-service");
  expect(mocks.save.mock.calls[1][1].apiKey).toBe("");
  expect(mocks.defaults.mock.calls[1]).toEqual([3, saved.id]);
  expect(result.current.settings?.revision).toBe(4);
  expect(result.current.selectionId).toBe(saved.id);
  expect(result.current.draft?.makeDefault).toBe(true);
  expect(result.current.dirtySelectionIds).toEqual([]);
  expect(result.current.error).toBeNull();
});
