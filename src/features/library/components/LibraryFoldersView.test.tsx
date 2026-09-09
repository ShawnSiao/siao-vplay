import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LibraryRootSummary } from "../../../types";
import { LibraryFoldersView } from "./LibraryFoldersView";
import type { RootOverviewReader } from "../useRootOverviewPages";

function reader(folders: LibraryRootSummary[]): RootOverviewReader {
  return async input => ({ scope: "roots", offset: input.offset, snapshotToken: "a".repeat(64), totalCount: folders.length,
    nextOffset: input.offset + 24 < folders.length ? input.offset + 24 : null, items: folders.slice(input.offset, input.offset + 24) });
}

function folder(
  id: string,
  status: LibraryRootSummary["status"],
  availability: LibraryRootSummary["availability"],
): LibraryRootSummary {
  return {
    id,
    path: `W:\\${id}`,
    displayName: id,
    status,
    availability,
    lastScannedAtMs: 1,
    itemCount: 1,
  };
}

describe("LibraryFoldersView", () => {
  it("bounds rendered folder rows for a large authorization list", async () => {
    const { container } = render(<LibraryFoldersView readRoots={reader(Array.from({ length: 1000 }, (_, i) => folder(`目录 ${i}`, "linked", "available")))}
      onImportFolder={vi.fn()} onRescanRoot={vi.fn()} onRelocateRoot={vi.fn()} onRebuildRoot={vi.fn()} onRequestRevoke={vi.fn()} />);
    await screen.findByText("目录 0");
    expect(container.querySelectorAll(".library-folder-row")).toHaveLength(24);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("目录 24");
    expect(container.querySelectorAll(".library-folder-row")).toHaveLength(24);
    expect(screen.queryByText("目录 0")).not.toBeInTheDocument();
  });
  it("maps each supported folder state to one primary action", async () => {
    render(
      <LibraryFoldersView
        readRoots={reader([
          folder("已关联", "linked", "available"),
          folder("已离线", "linked", "offline"),
          folder("待重建", "orphaned", "available"),
          folder("离线待重建", "orphaned", "offline"),
          folder("关联冲突", "ambiguous", "available"),
        ])}
        onImportFolder={vi.fn()}
        onRescanRoot={vi.fn()}
        onRelocateRoot={vi.fn()}
        onRebuildRoot={vi.fn()}
        onRequestRevoke={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "扫描更新 已关联" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新定位 已离线" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重建剧集 待重建" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择位置并重建 离线待重建" }))
      .toBeInTheDocument();
    expect(screen.getByText("需要人工整理")).toBeInTheDocument();
    expect(screen.queryByLabelText("关联冲突 的文件夹操作"))
      .not.toBeInTheDocument();
  });
  it("keeps recovery callbacks bound to the displayed root on later pages", async () => {
    const callbacks = { onImportFolder: vi.fn(), onRescanRoot: vi.fn(), onRelocateRoot: vi.fn(), onRebuildRoot: vi.fn(), onRequestRevoke: vi.fn() };
    const roots = Array.from({ length: 24 }, (_, i) => folder(`初页 ${i}`, "linked", "available"));
    roots.push(folder("已关联", "linked", "available"), folder("已离线", "linked", "offline"),
      folder("待重建", "orphaned", "available"), folder("离线待重建", "orphaned", "offline"), folder("冲突", "ambiguous", "available"));
    render(<LibraryFoldersView readRoots={reader(roots)} {...callbacks} />);
    await screen.findByText("初页 0");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(await screen.findByRole("button", { name: "扫描更新 已关联" }));
    fireEvent.click(screen.getByRole("button", { name: "重新定位 已离线" }));
    fireEvent.click(screen.getByRole("button", { name: "重建剧集 待重建" }));
    fireEvent.click(screen.getByRole("button", { name: "选择位置并重建 离线待重建" }));
    fireEvent.click(screen.getByRole("button", { name: "已离线 的文件夹操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "撤销授权" }));
    expect(callbacks.onRescanRoot).toHaveBeenCalledWith("已关联");
    expect(callbacks.onRelocateRoot).toHaveBeenCalledWith("已离线");
    expect(callbacks.onRebuildRoot.mock.calls).toEqual([["待重建", false], ["离线待重建", true]]);
    expect(callbacks.onRequestRevoke).toHaveBeenCalledWith("已离线");
    expect(screen.getByRole("button", { name: "已离线 的文件夹操作" })).toHaveFocus();
    expect(screen.queryByLabelText("冲突 的文件夹操作")).not.toBeInTheDocument();
  });
  it("restores focus after a refreshed root disappears without stealing outside focus", async () => {
    const roots = [folder("首个", "linked", "available"), folder("后续", "linked", "available")];
    const readRoots = reader(roots);
    const callbacks = { onImportFolder: vi.fn(), onRescanRoot: vi.fn(), onRelocateRoot: vi.fn(), onRebuildRoot: vi.fn(), onRequestRevoke: vi.fn() };
    const content = (refreshKey: number) => <><button>outside</button><LibraryFoldersView refreshKey={refreshKey} readRoots={readRoots} {...callbacks} /></>;
    const view = render(content(0));
    (await screen.findByRole("button", { name: "扫描更新 首个" })).focus();
    roots.shift(); view.rerender(content(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "扫描更新 后续" })).toHaveFocus());
    screen.getByRole("button", { name: "outside" }).focus();
    roots.shift(); view.rerender(content(2));
    await screen.findByText("还没有授权文件夹");
    expect(screen.getByRole("button", { name: "outside" })).toHaveFocus();
  });
  it("does not steal focus when a pending page finishes after attention moved outside", async () => {
    const roots = Array.from({ length: 26 }, (_, i) => folder(`目录 ${i}`, "linked", "available"));
    const normalRead = reader(roots);
    let finish!: () => void;
    const readRoots: RootOverviewReader = input => input.offset === 0 ? normalRead(input)
      : new Promise(resolve => { finish = () => { void normalRead(input).then(resolve); }; });
    render(<><button>outside</button><LibraryFoldersView readRoots={readRoots} onImportFolder={vi.fn()}
      onRescanRoot={vi.fn()} onRelocateRoot={vi.fn()} onRebuildRoot={vi.fn()} onRequestRevoke={vi.fn()} /></>);
    await screen.findByText("目录 0");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    screen.getByRole("button", { name: "outside" }).focus();
    await act(async () => { finish(); });
    expect(screen.getByRole("button", { name: "outside" })).toHaveFocus();
    expect(screen.getByText("目录 24")).toBeInTheDocument();
  });
});
