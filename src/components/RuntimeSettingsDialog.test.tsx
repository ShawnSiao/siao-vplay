import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeCatalog } from "../types";

const desktopMocks = vi.hoisted(() => ({
  chooseRuntimeStorageRoot: vi.fn(),
  setRuntimeStorageRoot: vi.fn(),
  setPreferredModel: vi.fn(),
  downloadRuntimeComponent: vi.fn(),
}));

vi.mock("../lib/desktop", () => ({
  ...desktopMocks,
  commandError: (error: unknown) => ({
    code: "test_error",
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import { RuntimeSettingsDialog } from "./RuntimeSettingsDialog";

const catalog: RuntimeCatalog = {
  settings: {
    storageRoot: null,
    preferredModel: "small",
  },
  components: [
    {
      id: "whisper-cpu",
      title: "Whisper CPU",
      componentKind: "bundled",
      version: "1.9.1-siaocut.1",
      available: true,
      installedPath: "W:\\SiaoVPlay\\runtimes\\whisper",
      expectedSizeBytes: 0,
      installedSizeBytes: null,
      expectedSha256: "",
      sourceUrl: "https://github.com/ggml-org/whisper.cpp",
      sourcePage: "https://github.com/ggml-org/whisper.cpp",
      license: "MIT",
      errorMessage: null,
    },
    {
      id: "ffmpeg",
      title: "FFmpeg",
      componentKind: "download",
      version: "8.1.2-essentials",
      available: false,
      installedPath: null,
      expectedSizeBytes: 109_728_040,
      installedSizeBytes: null,
      expectedSha256: "a".repeat(64),
      sourceUrl: "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg.zip",
      sourcePage: "https://www.gyan.dev/ffmpeg/builds/",
      license: "GPL-3.0-or-later",
      errorMessage: "未找到固定大小的组件",
    },
    {
      id: "whisper-small",
      title: "Whisper Small",
      componentKind: "download",
      version: "whisper.cpp pinned model",
      available: false,
      installedPath: null,
      expectedSizeBytes: 487_601_967,
      installedSizeBytes: null,
      expectedSha256: "b".repeat(64),
      sourceUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
      sourcePage: "https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md",
      license: "MIT / OpenAI Whisper model terms",
      errorMessage: "尚未下载",
    },
  ],
};

describe("RuntimeSettingsDialog", () => {
  it("changes the storage root, preferred model, and download action", async () => {
    const onCatalogChange = vi.fn();
    desktopMocks.chooseRuntimeStorageRoot.mockResolvedValue("W:\\SiaoVPlay\\runtime-data");
    desktopMocks.setRuntimeStorageRoot.mockResolvedValue({
      ...catalog,
      settings: {
        ...catalog.settings,
        storageRoot: "W:\\SiaoVPlay\\runtime-data",
      },
    });
    desktopMocks.setPreferredModel.mockResolvedValue({
      ...catalog,
      settings: { ...catalog.settings, preferredModel: "base" },
    });
    desktopMocks.downloadRuntimeComponent.mockResolvedValue({
      ...catalog,
      components: catalog.components.map((component) =>
        component.id === "ffmpeg"
          ? { ...component, available: true }
          : component,
      ),
    });

    const { rerender } = render(
      <RuntimeSettingsDialog
        catalog={catalog}
        loading={false}
        previewMode={false}
        onClose={() => undefined}
        onCatalogChange={onCatalogChange}
        onError={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    await waitFor(() =>
      expect(desktopMocks.setRuntimeStorageRoot).toHaveBeenCalledWith(
        "W:\\SiaoVPlay\\runtime-data",
      ),
    );
    expect(onCatalogChange).toHaveBeenCalled();

    rerender(
      <RuntimeSettingsDialog
        catalog={{
          ...catalog,
          settings: {
            ...catalog.settings,
            storageRoot: "W:\\SiaoVPlay\\runtime-data",
          },
        }}
        loading={false}
        previewMode={false}
        onClose={() => undefined}
        onCatalogChange={onCatalogChange}
        onError={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /base/i }));
    await waitFor(() =>
      expect(desktopMocks.setPreferredModel).toHaveBeenCalledWith("base"),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "下载组件" })[0]);
    await waitFor(() =>
      expect(desktopMocks.downloadRuntimeComponent).toHaveBeenCalledWith(
        "ffmpeg",
      ),
    );
  });

  it("blocks downloads until a storage root is selected", () => {
    render(
      <RuntimeSettingsDialog
        catalog={catalog}
        loading={false}
        previewMode={false}
        onClose={() => undefined}
        onCatalogChange={() => undefined}
        onError={() => undefined}
      />,
    );

    const downloadButton = screen.getAllByRole("button", { name: "先选择目录" })[0];
    expect(downloadButton).toBeDisabled();
    expect(
      screen.getByText("下载 FFmpeg 或识别模型前，需要先选择目录。"),
    ).toBeInTheDocument();
  });
});
