import { afterAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  return { invoke: vi.fn() };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { getMediaRuntimeStatus, getTranscriptionRuntimeStatus } from "./desktop";
const media = { available: true, ffmpegPath: "W:/ffmpeg.exe", ffprobePath: "W:/ffprobe.exe", version: "8.1", errorMessage: null };
const runtime = { backend: "cpu", available: true, path: "W:/whisper", version: "1", errorMessage: null };
const model = { modelKind: "small", available: true, path: "W:/small.bin", errorMessage: null };
const transcription = { available: true, preferredBackend: "cpu", runtimes: [runtime], models: [model] };
beforeEach(() => mocks.invoke.mockReset());
afterAll(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });
it.each([{ available: true }, { ...media, ffprobePath: null }, { ...media, errorMessage: "failed" }])("rejects invalid media readiness", async value => {
  mocks.invoke.mockResolvedValue(value); await expect(getMediaRuntimeStatus()).rejects.toThrow();
});
it.each([{ available: true }, { ...transcription, models: [] }, { ...transcription, preferredBackend: "vulkan" }, { ...transcription, runtimes: [runtime, runtime] }, { ...transcription, models: [model, model] }, { ...transcription, runtimes: [{ ...runtime, path: null }] }])("rejects invalid transcription readiness", async value => {
  mocks.invoke.mockResolvedValue(value); await expect(getTranscriptionRuntimeStatus()).rejects.toThrow();
});
it("preserves valid ready and unavailable states", async () => {
  mocks.invoke.mockResolvedValueOnce(media).mockResolvedValueOnce(transcription).mockResolvedValueOnce({ available: false, preferredBackend: null, runtimes: [], models: [] });
  await expect(getMediaRuntimeStatus()).resolves.toEqual(media);
  await expect(getTranscriptionRuntimeStatus()).resolves.toEqual(transcription);
  await expect(getTranscriptionRuntimeStatus()).resolves.toMatchObject({ available: false });
});
