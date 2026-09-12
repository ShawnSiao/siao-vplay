import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { SubtitleVersion } from "../types";
import { createTranslationTask } from "../test-fixtures/translation";
import { TranslationDialog } from "./TranslationDialog";
import { getCodexRuntimeStatus } from "../lib/desktop";

const mocks = vi.hoisted(() => ({ list: vi.fn(), setKind: vi.fn(), prepare: vi.fn(), start: vi.fn() }));
vi.mock("../lib/desktop", async (original) => ({
  ...await original<typeof import("../lib/desktop")>(),
  getCodexRuntimeStatus: vi.fn().mockResolvedValue({ available: true }),
  listTranslationTasks: mocks.list,
  prepareTranslationTask: mocks.prepare,
  startCodexTranslationTask: mocks.start,
  readTranslationPrompt: vi.fn().mockResolvedValue("controlled prompt"),
}));
vi.mock("../features/ai-tasks/useAiExecutionChoice", () => ({
  useAiExecutionChoice: () => ({ kind: "codex", setKind: mocks.setKind, services: [] }),
}));

const source = { id: "source-1", projectId: "project-1", languageCode: "ja", segments: [{ id: "line-1" }] } as SubtitleVersion;
const completed = { ...createTranslationTask(source.projectId, source), status: "completed" as const, outputVersionId: "translated-1" };
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([completed]); });

it("offers a new task instead of retrying a changed project baseline", async () => {
  mocks.list.mockResolvedValue([{ ...completed, status: "failed", handoffKind: "api", outputVersionId: null, errorCode: "project_changed", errorMessage: "项目已变化" }]);
  render(<TranslationDialog projectId={source.projectId} sourceVersion={source} translationVersions={[]} onClose={vi.fn()} onPrepareOriginal={vi.fn()} onTaskCompleted={vi.fn()} />);
  await screen.findByText("项目已变化");
  expect(screen.queryByRole("button", { name: "重试未完成批次" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新准备翻译" }));
  expect(await screen.findByRole("button", { name: "准备翻译材料" })).toBeInTheDocument();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("lets an invalidated manual handoff return to preparation", async () => {
  mocks.list.mockResolvedValue([{ ...completed, status: "awaiting_external_result", handoffKind: "manual", outputVersionId: null, errorCode: "project_changed", errorMessage: "项目已变化" }]);
  render(<TranslationDialog projectId={source.projectId} sourceVersion={source} translationVersions={[]} onClose={vi.fn()} onPrepareOriginal={vi.fn()} onTaskCompleted={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "重新准备翻译" }));
  expect(await screen.findByRole("button", { name: "准备翻译材料" })).toBeInTheDocument();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

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

it("restores completed subtitles even when optional Codex detection fails", async () => {
  vi.mocked(getCodexRuntimeStatus).mockRejectedValueOnce(new Error("detection unavailable"));
  const read = vi.fn().mockResolvedValue(undefined);
  render(<TranslationDialog projectId={source.projectId} sourceVersion={source} translationVersions={[]} onClose={vi.fn()} onPrepareOriginal={vi.fn()} onTaskCompleted={read} />);
  await waitFor(() => expect(read).toHaveBeenCalledWith(completed));
});

it("blocks preparation until task history is known", async () => {
  let finish!: (tasks: typeof completed[]) => void;
  mocks.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<TranslationDialog projectId={source.projectId} sourceVersion={source} translationVersions={[]} onClose={vi.fn()} onPrepareOriginal={vi.fn()} onTaskCompleted={vi.fn()} />);
  await waitFor(() => expect(getCodexRuntimeStatus).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "准备翻译材料" })).not.toBeInTheDocument();
  await act(async () => finish([completed]));
});

it("retries history failure and restores a completed task without retranslating", async () => {
  mocks.list.mockRejectedValueOnce(new Error("history unavailable")).mockResolvedValue([completed]);
  const read = vi.fn().mockResolvedValue(undefined);
  render(<TranslationDialog projectId={source.projectId} sourceVersion={source} translationVersions={[]} onClose={vi.fn()} onPrepareOriginal={vi.fn()} onTaskCompleted={read} />);
  expect(await screen.findByText("history unavailable")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "准备翻译材料" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新读取翻译记录" }));
  await waitFor(() => expect(read).toHaveBeenCalledWith(completed));
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});
