import { beforeEach, expect, it, vi } from "vitest";
import { exportSubtitles } from "./desktop";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
const output = { filePath: "W:/exports/subtitles.srt", manifestPath: "W:/exports/subtitles.srt.siaovplay.json", fileSha256: "a".repeat(64), mediaSha256: "b".repeat(64), mode: "bilingual", format: "srt", cueCount: 2, sourceVersionId: "source", translationVersionId: "translation", exportedAtMs: 1 };
const run = () => exportSubtitles("project", "bilingual", "srt", "source", "translation", "W:/exports");
it.each([null, {}, {...output, sourceVersionId:"other"}, {...output, format:"vtt"}, {...output, cueCount:-1}, {...output, fileSha256:"bad"}, {...output, manifestPath:""}, {...output, exportedAtMs:1.5}])("rejects invalid or unrelated export %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(run()).rejects.toThrow();
});
it("accepts the selected bilingual export", async () => {
  mocks.invoke.mockResolvedValue(output);
  await expect(run()).resolves.toEqual(output);
});

it.each(["original", "translation"] as const)("matches %s version selection and null unused track", async mode => {
  const value = { ...output, mode, sourceVersionId: mode === "translation" ? null : "source", translationVersionId: mode === "original" ? null : "translation" };
  mocks.invoke.mockResolvedValue(value);
  await expect(exportSubtitles("project", mode, "srt", "source", "translation", "W:/exports")).resolves.toEqual(value);
  expect(mocks.invoke).toHaveBeenCalledWith("export_subtitles", { input: { projectId:"project", mode, format:"srt", sourceVersionId:"source", translationVersionId:"translation", destinationDirectory:"W:/exports", confirmVersionSelection:true } });
});
