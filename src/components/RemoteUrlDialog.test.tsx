import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { YouTubeMediaPreview } from "../types";
import { RemoteUrlDialog } from "./RemoteUrlDialog";

const desktopMocks = vi.hoisted(() => ({
  inspectYouTubeUrl: vi.fn(),
  getPublicResolverDisclosure: vi.fn(),
  importYouTubeUrl: vi.fn(),
}));

vi.mock("../lib/desktop", () => ({
  getPublicResolverDisclosure: desktopMocks.getPublicResolverDisclosure,
  cancelRemoteMediaImport: vi.fn(),
  cancelYouTubeImport: vi.fn(),
  commandError: (error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error
    ) {
      return { code: String(error.code), message: String(error.message) };
    }
    return { code: "unexpected_error", message: String(error) };
  },
  importRemoteMediaUrl: vi.fn(),
  importYouTubeUrl: desktopMocks.importYouTubeUrl,
  inspectRemoteMediaUrl: vi.fn(),
  inspectYouTubeUrl: desktopMocks.inspectYouTubeUrl,
}));

const preview: YouTubeMediaPreview = {
  originalUrl: "https://www.youtube.com/watch?v=3bL6IpdgddQ",
  webpageUrl: "https://www.youtube.com/watch?v=3bL6IpdgddQ",
  videoId: "3bL6IpdgddQ",
  title: "Natural Conversations with GPT-Live",
  durationSeconds: 177.679,
  fileSizeBytes: 110_042_832,
  importerVersion: "2026.08.19",
  importerSha256:
    "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
  previewToken: "preview-token",
};

const xPreview: YouTubeMediaPreview = {
  ...preview,
  originalUrl: "https://x.com/openai/status/1234567890",
  webpageUrl: "https://x.com/openai/status/1234567890",
  videoId: "1234567800",
  title: "Public X video",
  durationSeconds: 28.5,
  fileSizeBytes: 733_067,
  previewToken: "x-preview-token",
};

describe("RemoteUrlDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktopMocks.getPublicResolverDisclosure.mockResolvedValue({ receiver: "https://resolver.example", resolverBase: "https://resolver.example/status/" });
    desktopMocks.inspectYouTubeUrl.mockResolvedValue(preview);
  });

  it("discloses the configured X recipient and requires an explicit fallback choice", async () => {
    desktopMocks.inspectYouTubeUrl.mockResolvedValue(xPreview);
    render(<RemoteUrlDialog previewMode={false} onClose={() => undefined} onImported={() => undefined} />);
    fireEvent.change(screen.getByLabelText("视频 URL"), { target: { value: xPreview.originalUrl } });
    const consent = await screen.findByRole("checkbox", { name: /允许直接解析失败后/ });
    expect(consent).not.toBeChecked();
    expect(screen.getByText(/https:\/\/resolver.example/)).toBeVisible();
    fireEvent.click(consent);
    fireEvent.click(screen.getByRole("button", { name: "检查 URL" }));
    await waitFor(() => expect(desktopMocks.inspectYouTubeUrl).toHaveBeenCalledWith(xPreview.originalUrl, "https://resolver.example/status/"));
    fireEvent.change(screen.getByLabelText("视频 URL"), { target: { value: "https://x.com/openai/status/9876543210" } });
    expect(screen.getByRole("checkbox", { name: /允许直接解析失败后/ })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("视频 URL"), { target: { value: xPreview.originalUrl } });
    expect(screen.getByRole("checkbox", { name: /允许直接解析失败后/ })).not.toBeChecked();
  });

  it("does not expose raw downloader output when a public video import fails", async () => {
    desktopMocks.importYouTubeUrl.mockRejectedValueOnce({
      code: "youtube_download_failed",
      message:
        "ERROR: unable to download video data: HTTP Error 403 at C:\\private\\source.mp4",
    });

    render(
      <RemoteUrlDialog
        previewMode={false}
        onClose={() => undefined}
        onImported={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("视频 URL"), {
      target: { value: preview.originalUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查 URL" }));
    await screen.findByText("公开单视频");
    fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));

    await waitFor(() => expect(desktopMocks.importYouTubeUrl).toHaveBeenCalled());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("公开视频暂时无法下载");
    expect(alert).toHaveTextContent("更新公开视频组件");
    expect(alert).not.toHaveTextContent(/ERROR|403|yt-dlp|C:\\/i);
  });

  it("inspects and imports an X status URL through the managed public-page pipeline", async () => {
    desktopMocks.inspectYouTubeUrl.mockResolvedValueOnce(xPreview);
    desktopMocks.importYouTubeUrl.mockResolvedValueOnce({ id: "x-project" });

    render(
      <RemoteUrlDialog
        previewMode={false}
        onClose={() => undefined}
        onImported={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("视频 URL"), {
      target: { value: xPreview.originalUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查 URL" }));

    expect(await screen.findByText("X 公开视频")).toBeVisible();
    expect(screen.getByText("x.com")).toBeVisible();
    expect(screen.getByText("0:29")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));

    await waitFor(() =>
      expect(desktopMocks.importYouTubeUrl).toHaveBeenCalledWith(
        xPreview.originalUrl,
        xPreview.previewToken,
        expect.any(String),
        null,
      ),
    );
  });
});
