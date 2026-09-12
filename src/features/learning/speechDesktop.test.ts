import { beforeEach, expect, it, vi } from "vitest";
import { listSpeechVoices, synthesizeSpeech } from "./speechDesktop";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/desktop", () => ({ isDesktopApp: true }));
beforeEach(() => { mocks.invoke.mockReset(); });
const voice = { id: "voice", displayName: "English", language: "en-US" };
const request = { text: "Hello", language: "en", voiceId: "voice" };
const audio = { bytes: [0, 255, 1], mimeType: "audio/wav", voiceId: "voice", language: "en-US" };
it.each([null, {}, [null], [{ ...voice, id: " " }], [{ ...voice, language: 42 }], [voice, voice]].map(value => ({ value })))("rejects malformed voice lists $value", async ({ value }) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(listSpeechVoices()).rejects.toThrow();
});
it.each([[], [voice]].map(value => ({ value })))("accepts installed voices $value", async ({ value }) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(listSpeechVoices()).resolves.toEqual(value);
});
it.each([null, {}, { ...audio, bytes: [] }, { ...audio, bytes: [-1] },
  { ...audio, bytes: [256] }, { ...audio, bytes: [0.5] }, { ...audio, bytes: ["1"] },
  { ...audio, voiceId: "other" }, { ...audio, language: "ja-JP" },
  { ...audio, mimeType: "text/html" }])("rejects malformed or mismatched audio %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(synthesizeSpeech(request)).rejects.toThrow();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("preserves valid audio and accepts regional fallback", async () => {
  mocks.invoke.mockResolvedValue(audio);
  await expect(synthesizeSpeech(request)).resolves.toEqual(audio);
  expect(mocks.invoke).toHaveBeenCalledWith("synthesize_speech", { request });
});
it("accepts backend automatic voice selection", async () => {
  mocks.invoke.mockResolvedValue(audio);
  await expect(synthesizeSpeech({ ...request, voiceId: "" })).resolves.toEqual(audio);
});
