import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, type Mock } from "vitest";
import App from "./App";
import type { LocalResourceStatus, Project } from "./types";

type Context = {
  desktopMocks: Record<"prepareLocalCapability" | "getLocalResourceStatus" | "chooseLocalVideo" | "listenResourceDownloadTasks" | "openLocalProject" | "prepareProjectMedia", Mock>;
  readyLocalResourceStatus: LocalResourceStatus;
  project: Project;
  getAddMediaCommand: (name: RegExp) => Promise<HTMLElement>;
};

export async function verifyDismissedResourceAction({ desktopMocks, readyLocalResourceStatus, project, getAddMediaCommand }: Context) {
    let currentStatus: LocalResourceStatus = {
      ...readyLocalResourceStatus,
      capabilities: readyLocalResourceStatus.capabilities.map(capability => ({ ...capability, state: "not_ready", missingResourceIds: ["ffmpeg-cpu"] })),
    };
    let snapshotRevision = 0;
    desktopMocks.getLocalResourceStatus.mockImplementation(async () => ({ ...currentStatus, snapshotRevision: ++snapshotRevision }));
    desktopMocks.chooseLocalVideo.mockResolvedValue(project.mediaSource.locator);
    render(<App />);
    await screen.findByText("本地功能按需准备");
    fireEvent.click(await getAddMediaCommand(/打开本地视频/));
    const settings = await screen.findByRole("dialog", { name: "设置" });
    expect(settings).toHaveTextContent("继续打开本地视频");
    fireEvent.click(within(settings).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    currentStatus = readyLocalResourceStatus;
    const notify = desktopMocks.listenResourceDownloadTasks.mock.calls[0][0];
    await act(async () => {
      notify({ id: "completed-resource", resourceId: "ffmpeg-cpu", version: "fixture", state: "completed", downloadedBytes: 1, totalBytes: 1,
        requestedByCapabilityIds: ["basic_media"], pendingActionIds: [], attempt: 1, errorCode: null, errorMessage: null,
        createdAtMs: 1, updatedAtMs: 2, forceReinstall: false, generation: 1, revision: 1 });
    });
    await screen.findByText(/\d+ 项本地功能已准备/);
    expect(desktopMocks.chooseLocalVideo).toHaveBeenCalledTimes(1);
    expect(desktopMocks.openLocalProject).not.toHaveBeenCalled();
    expect(desktopMocks.prepareProjectMedia).not.toHaveBeenCalled();
}

export async function verifySelectedResourceResume({ desktopMocks, readyLocalResourceStatus, project, getAddMediaCommand }: Context) {
    const basicNotReady: LocalResourceStatus = {
      ...readyLocalResourceStatus,
      capabilities: readyLocalResourceStatus.capabilities.map((capability) => ({
        ...capability,
        state: "not_ready",
        missingResourceIds: ["ffmpeg-cpu"],
      })),
    };
    let currentResourceStatus = basicNotReady;
    let snapshotRevision = 0;
    desktopMocks.getLocalResourceStatus.mockImplementation(
      async () => ({ ...currentResourceStatus, snapshotRevision: ++snapshotRevision }),
    );
    desktopMocks.chooseLocalVideo.mockResolvedValue(project.mediaSource.locator);
    desktopMocks.prepareLocalCapability.mockImplementation(
      async (capabilityId, pendingActionId) => {
        currentResourceStatus = readyLocalResourceStatus;
        return {
          capabilityId,
          pendingActionId,
          state: "preparing",
          resourceIds: ["ffmpeg-cpu"],
          readyResourceIds: [],
          taskIds: ["00000000-0000-4000-8000-000000000021"],
        };
      },
    );

    render(<App />);
    await screen.findByText("本地功能按需准备");
    fireEvent.click(await getAddMediaCommand(/打开本地视频/));

    const resources = await screen.findByRole("dialog", {
      name: "设置",
    });
    expect(resources).toHaveTextContent("继续打开本地视频");
    expect(desktopMocks.openLocalProject).not.toHaveBeenCalled();
    fireEvent.click(
      within(resources).getByRole("button", { name: "开始准备所选功能" }),
    );

    await waitFor(() =>
      expect(desktopMocks.prepareLocalCapability).toHaveBeenCalledWith(
        "basic_media",
        expect.any(String),
      ),
    );
    await waitFor(() => expect(desktopMocks.openLocalProject).toHaveBeenCalledWith(project.mediaSource.locator));
    expect(desktopMocks.chooseLocalVideo).toHaveBeenCalledTimes(1);
    expect(desktopMocks.openLocalProject).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(desktopMocks.prepareProjectMedia).toHaveBeenCalledWith(
        project.id,
        false, expect.any(String),
      ),
    );
}
