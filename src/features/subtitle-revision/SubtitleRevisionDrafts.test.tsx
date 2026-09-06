import { subtitleMetadata } from "./subtitleMetadata";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleRevisionDialog } from "../../components/SubtitleRevisionDialog";
import type { Project, SubtitleVersion } from "../../types";
const revise = vi.hoisted(() => vi.fn());
const restore = vi.hoisted(() => vi.fn());
vi.mock("../../lib/desktop", () => ({ reviseSubtitleVersion: revise, restoreSubtitleVersion: restore, commandError: (error: Error) => error }));
function track(role: "original" | "translation"): SubtitleVersion {
  return { id: role, role, isCurrent: true, projectId: "p", trackId: role, versionNumber: 1,
    segments: [1, 2].map((n) => ({ id: `${role}-${n}`, lineageId: `${role}-${n}`, text: `${role} ${n}`, ordinal: n, startMs: n * 1_000, endMs: n * 1_000 + 500, issueKind: null })) } as SubtitleVersion;
}
function setup() {
  const onClose = vi.fn(); const onVersionCreated = vi.fn().mockResolvedValue(undefined);
  render(<SubtitleRevisionDialog project={{ id: "p", revision: 1, playbackState: { positionMs: 0 } } as Project}
    versions={[track("original"), track("translation")]} onClose={onClose} onVersionCreated={onVersionCreated} onRetranslate={vi.fn()} />);
  return { onClose, onVersionCreated };
}
describe("subtitle edit drafts", () => {
  beforeEach(() => { revise.mockReset(); restore.mockReset(); });
  it("preserves edits when switching sentences and tracks", () => {
    setup();
    fireEvent.change(screen.getByRole("textbox", { name: "简体中文字幕" }), { target: { value: "我的修正" } });
    fireEvent.click(screen.getByRole("button", { name: /translation 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /translation 1/ }));
    expect(screen.getByRole("textbox", { name: "简体中文字幕" })).toHaveValue("我的修正");
    fireEvent.click(screen.getByRole("tab", { name: /原文字幕/ }));
    fireEvent.click(screen.getByRole("tab", { name: /简体中文/ }));
    expect(screen.getByRole("textbox", { name: "简体中文字幕" })).toHaveValue("我的修正");
  });
  it("keeps the editor open after saving and retains input when saving fails", async () => {
    const { onClose } = setup();
    const next = track("translation"); next.id = "translation-v2"; next.versionNumber = 2; next.projectRevision = 2;
    next.segments[0] = { ...next.segments[0], id: "new-id", text: "我的修正" };
    revise.mockResolvedValueOnce(next).mockRejectedValueOnce(new Error("磁盘空间不足"));
    fireEvent.change(screen.getByRole("textbox", { name: "简体中文字幕" }), { target: { value: "我的修正" } });
    fireEvent.click(screen.getByRole("button", { name: /保存为新版本/ }));
    await waitFor(() => expect(revise).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "简体中文字幕" })).toHaveValue("我的修正"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "简体中文字幕" }), { target: { value: "继续修改" } });
    fireEvent.click(screen.getByRole("button", { name: /保存为新版本/ }));
    expect(await screen.findByText("磁盘空间不足")).toBeInTheDocument();
    expect(revise.mock.calls[1].slice(0, 3)).toEqual(["p", "translation-v2", 2]);
    expect(screen.getByRole("textbox", { name: "简体中文字幕" })).toHaveValue("继续修改");
  });
  it("protects every close path while saving and asks before discarding drafts", async () => {
    const { onClose } = setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.change(screen.getByRole("textbox", { name: "简体中文字幕" }), { target: { value: "未保存" } });
    fireEvent.click(screen.getByRole("button", { name: "返回观看" }));
    expect(confirm).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled();
    let resolve!: (value: SubtitleVersion) => void;
    revise.mockReturnValue(new Promise<SubtitleVersion>((yes) => { resolve = yes; }));
    fireEvent.click(screen.getByRole("button", { name: /保存为新版本/ }));
    expect(screen.getByRole("button", { name: "返回观看" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).not.toHaveBeenCalled();
    resolve(track("translation"));
    await waitFor(() => expect(screen.getByRole("button", { name: "返回观看" })).toBeEnabled());
    confirm.mockRestore();
  });
});

it("restores a metadata-only historical version and retains prior versions as metadata", async () => {
  const current = { ...track("translation"), versionNumber: 2, projectRevision: 2 };
  const historical = subtitleMetadata({ ...current, id: "historical", versionNumber: 1, isCurrent: false });
  const restored = { ...current, id: "restored", versionNumber: 3, projectRevision: 3,
    segments: current.segments.map((item) => ({ ...item, text: "历史内容" })) };
  restore.mockResolvedValue(restored);
  render(<SubtitleRevisionDialog project={{ id: "p", revision: 2, playbackState: { positionMs: 0 } } as Project}
    versions={[current]} historyVersions={[historical]} onClose={vi.fn()} onVersionCreated={vi.fn().mockResolvedValue(undefined)} onRetranslate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "历史版本" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复为新版本" }));
  await waitFor(() => expect(restore).toHaveBeenCalledWith("p", current.id, "historical", 2));
  await waitFor(() => expect(screen.getByRole("tab", { name: /简体中文/ })).toHaveTextContent("版本 3"));
  expect(screen.getByText("版本 2")).toBeInTheDocument();
  expect(screen.getByText("版本 1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "逐句修正" }));
  expect(screen.getByRole("textbox", { name: "简体中文字幕" })).toHaveValue("历史内容");
});
