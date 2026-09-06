import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { SubtitleVersion } from "../types";
import { createTranslationTask } from "../test-fixtures/translation";
import { TranslationDialog } from "./TranslationDialog";

const mocks = vi.hoisted(() => ({ list: vi.fn(), setKind: vi.fn(), prepare: vi.fn(), start: vi.fn() }));
vi.mock("../lib/desktop", async (original) => ({
  ...await original<typeof import("../lib/desktop")>(),
  getCodexRuntimeStatus: vi.fn().mockResolvedValue({ available: true }),
  listTranslationTasks: mocks.list,
  prepareTranslationTask: mocks.prepare,
  startCodexTranslationTask: mocks.start,
}));
vi.mock("../features/ai-tasks/useAiExecutionChoice", () => ({
  useAiExecutionChoice: () => ({ kind: "codex", setKind: mocks.setKind }),
}));

const source = { id: "source-1", projectId: "project-1", languageCode: "ja", segments: [{ id: "line-1" }] } as SubtitleVersion;
const completed = { ...createTranslationTask(source.projectId, source), status: "completed" as const, outputVersionId: "translated-1" };
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([completed]); });

it("retries reading completed subtitles without translating again", async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error("database busy")).mockResolvedValue(undefined);
  render(<TranslationDialog projectId={source.projectId} sourceVersion={source} translationVersions={[]} onClose={vi.fn()} onPrepareOriginal={vi.fn()} onTaskCompleted={read} />);
  expect(await screen.findByText("翻译已完成，但字幕暂时无法读取。请重试读取。" )).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "重新读取字幕" }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText(/字幕暂时无法读取/)).not.toBeInTheDocument());
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});
