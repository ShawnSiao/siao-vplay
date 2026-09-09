import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getPendingProjectCleanup: vi.fn(), deleteProject: vi.fn() }));
vi.mock("../lib/projectDeletionGateway", () => mocks);
import { ProjectCleanupNotice } from "./ProjectCleanupNotice";
const pending = { projectId: "deleted-project", pendingDirectories: 1 };
beforeEach(() => { vi.clearAllMocks(); mocks.getPendingProjectCleanup.mockResolvedValue(pending); });
it("finds cleanup after mounting and clears it after a successful retry", async () => {
  mocks.deleteProject.mockResolvedValue({ cleanupPending: 0 });
  render(<ProjectCleanupNotice revision={0} />);
  const button = await screen.findByRole("button", { name: "重试清理" });
  mocks.getPendingProjectCleanup.mockResolvedValue(null);
  fireEvent.click(button);
  await waitFor(() => expect(mocks.deleteProject).toHaveBeenCalledWith("deleted-project"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "重试清理" })).not.toBeInTheDocument());
});
it("retains recovery when files remain occupied", async () => {
  mocks.deleteProject.mockResolvedValue({ cleanupPending: 1 });
  render(<ProjectCleanupNotice revision={0} />);
  fireEvent.click(await screen.findByRole("button", { name: "重试清理" }));
  expect(await screen.findByText(/仍有文件未清理/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重试清理" })).toBeEnabled();
});
it("allows a failed status read to be retried", async () => {
  mocks.getPendingProjectCleanup.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(pending);
  render(<ProjectCleanupNotice revision={0} />);
  fireEvent.click(await screen.findByRole("button", { name: "重新检查" }));
  expect(await screen.findByRole("button", { name: "重试清理" })).toBeInTheDocument();
});
