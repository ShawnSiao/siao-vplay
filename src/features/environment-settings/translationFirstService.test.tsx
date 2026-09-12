import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TranslationDialog } from "../../components/TranslationDialog";
import type { SubtitleVersion } from "../../types";
import { createTranslationTask, translationDispatchFixture } from "../../test-fixtures/translation";
import { EnvironmentSettingsDialog } from "./EnvironmentSettingsDialog";
import { useSettingsNavigation } from "./useSettingsNavigation";
import type { LocalResourcesController } from "../resources/useLocalResources";
import { previewAiSettings, previewNetworkSettings } from "./previewData";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), completed: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("../../lib/desktop", async original => ({
  ...await original<typeof import("../../lib/desktop")>(),
  getCodexRuntimeStatus: vi.fn(async () => ({ available: false, authenticated: false, supported: false })),
  listTranslationTasks: vi.fn(async () => []),
}));

const source = { id: "original", projectId: "current-video", versionNumber: 1, languageCode: "ja",
  segments: [{ id: "original-line", startMs: 0, endMs: 1000, text: "こんにちは" }] } as SubtitleVersion;

function Flow() {
  const [open, setOpen] = useState(false);
  const navigation = useSettingsNavigation(() => setOpen(true));
  return <>
    <TranslationDialog projectId={source.projectId} sourceVersion={source} translationVersions={[]}
      onClose={vi.fn()} onPrepareOriginal={vi.fn()} onTaskCompleted={mocks.completed} />
    {open && <EnvironmentSettingsDialog selectedTab={navigation.tab} onTabChange={navigation.setTab}
      localResources={{} as LocalResourcesController} firstRun={false} pendingAction={null} previewMode={false}
      onClose={() => setOpen(false)} onDismissFirstRun={vi.fn()} onNotice={vi.fn()} />}
  </>;
}

it("configures the first API through settings and prepares the retained original only after returning", async () => {
  const service = { id: "new-service", providerId: "openai" as const, displayName: "OpenAI", protocol: "openai_responses" as const,
    baseUrl: "https://api.openai.com/v1", modelId: "fixture-model", credentialState: "stored" as const,
    connectionState: "untested" as const, capabilities: { understanding: true, learning: true, vision: false }, isDefault: true, revision: 1 };
  const saved = { ...previewAiSettings, revision: 1, services: [service], defaultServiceId: service.id };
  const task = { ...createTranslationTask(source.projectId, source), handoffKind: "api" as const };
  const preview = { ...translationDispatchFixture(task, source), receiver: "OpenAI", model: service.modelId };
  mocks.invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case "get_ai_service_settings": return previewAiSettings;
      case "get_network_settings": return previewNetworkSettings;
      case "save_ai_service": return saved;
      case "prepare_api_translation": return task;
      case "preview_translation_dispatch": return preview;
      case "start_api_translation": return { ...task, status: "completed", stage: "completed", progress: 1, outputVersionId: "new-translation" };
      default: throw new Error(`Unexpected isolated IPC: ${command}`);
    }
  });
  render(<Flow />);
  fireEvent.click(await screen.findByRole("button", { name: "进入设置添加 AI 服务" }));
  const settings = await screen.findByRole("dialog", { name: "设置" });
  fireEvent.click(await within(settings).findByRole("button", { name: /OpenAI/ }));
  fireEvent.change(within(settings).getByPlaceholderText("粘贴服务商提供的 API Key"), { target: { value: "synthetic-test-only" } });
  fireEvent.change(within(settings).getByPlaceholderText("连接后选择或手动填写模型"), { target: { value: service.modelId } });
  fireEvent.click(within(settings).getByRole("button", { name: "保存并使用" }));
  await within(settings).findByRole("button", { name: "保存设置" });
  fireEvent.click(within(settings).getByRole("button", { name: "关闭设置" }));
  expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /AI 服务.*使用保存的 API/ }));
  expect(screen.getByLabelText("模型")).toHaveValue(service.modelId);
  expect(mocks.invoke.mock.calls.some(([command]) => command === "prepare_api_translation")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "准备翻译材料" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("prepare_api_translation", { input: {
    projectId: source.projectId, sourceLanguageCode: "ja", targetLanguageCode: "zh-cn", segmentIds: null,
    execution: { kind: "api", serviceConfigId: service.id, modelId: service.modelId }, serviceRevision: 1,
  } }));
  expect(await screen.findByRole("region", { name: "翻译发送清单" })).toBeInTheDocument();
  expect(mocks.invoke.mock.calls.some(([command]) => command === "start_api_translation")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "确认发送并翻译" }));
  await waitFor(() => expect(mocks.completed).toHaveBeenCalledWith(expect.objectContaining({
    projectId: source.projectId, sourceVersionId: source.id, outputVersionId: "new-translation", status: "completed",
  })));
  expect(mocks.invoke).toHaveBeenCalledWith("start_api_translation", { input: { taskId: task.id, confirmationSha256: preview.confirmationSha256 } });
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "start_api_translation")).toHaveLength(1);
});
