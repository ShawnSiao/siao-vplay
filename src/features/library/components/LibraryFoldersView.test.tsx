import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LibraryRootSummary } from "../../../types";
import { LibraryFoldersView } from "./LibraryFoldersView";

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
  it("maps each supported folder state to one primary action", () => {
    render(
      <LibraryFoldersView
        folders={[
          folder("已关联", "linked", "available"),
          folder("已离线", "linked", "offline"),
          folder("待重建", "orphaned", "available"),
          folder("离线待重建", "orphaned", "offline"),
          folder("关联冲突", "ambiguous", "available"),
        ]}
        onImportFolder={vi.fn()}
        onRescanRoot={vi.fn()}
        onRelocateRoot={vi.fn()}
        onRebuildRoot={vi.fn()}
        onRequestRevoke={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "扫描更新 已关联" }))
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
});
