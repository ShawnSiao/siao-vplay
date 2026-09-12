import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CollectionOverviewGroup } from "./CollectionOverviewGroup";
import { importedDetail, libraryHome } from "../libraryControllerTestFixtures";
import { createMockOverviewReaders } from "../../../test/libraryQueryMocks";

function fixture() {
  const home = libraryHome(0);
  home.collections = [false, true].flatMap(rootLinked => Array.from({ length: 50 }, (_, i) => ({ ...importedDetail.summary,
    id: `${rootLinked ? "folder" : "manual"}-${i}`, title: `${rootLinked ? "文件夹" : "自建"} ${i}`, rootId: rootLinked ? "root" : null, systemKey: null,
  })));
  const read = vi.fn(createMockOverviewReaders(async () => home).readCollectionOverview);
  const open = vi.fn();
  const content = (revision: number) => <><button>outside</button>
    <CollectionOverviewGroup title="文件夹剧集" description="文件夹" rootLinked refreshKey={revision} readCollections={read} onOpenCollection={open} />
    <CollectionOverviewGroup title="自建合集" description="自建" rootLinked={false} refreshKey={revision} readCollections={read} onOpenCollection={open} />
  </>;
  const view = render(content(0));
  return { home, read, open, view, content };
}
it("pages and retries one group without replacing the other group", async () => {
  const { read, open } = fixture();
  await screen.findByRole("button", { name: "打开合集 自建 0" });
  const manual = within(screen.getByRole("region", { name: "自建合集" }));
  read.mockRejectedValueOnce(new Error("暂时失败"));
  manual.getByRole("button", { name: "下一页" }).focus();
  fireEvent.click(manual.getByRole("button", { name: "下一页" }));
  await manual.findByRole("alert");
  expect(manual.getByRole("button", { name: "打开合集 自建 0" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "打开合集 文件夹 0" })).toBeEnabled();
  fireEvent.click(manual.getByRole("button", { name: "重试读取" }));
  const target = await manual.findByRole("button", { name: "打开合集 自建 24" });
  expect(target).toHaveFocus();
  expect(manual.getAllByRole("button", { name: /^打开合集/ })).toHaveLength(24);
  fireEvent.click(target);
  expect(open).toHaveBeenCalledWith("manual-24");
  expect(screen.getByRole("button", { name: "打开合集 文件夹 0" })).toBeInTheDocument();
});
it("refreshes changed titles and clamps deletion without stealing another group's focus", async () => {
  const { home, view, content } = fixture();
  await screen.findByRole("button", { name: "打开合集 自建 0" });
  const manual = within(screen.getByRole("region", { name: "自建合集" }));
  fireEvent.click(manual.getByRole("button", { name: "下一页" }));
  await manual.findByRole("button", { name: "打开合集 自建 24" });
  const outside = screen.getByRole("button", { name: "打开合集 文件夹 0" });
  outside.focus();
  home.collections = home.collections.filter(item => item.rootId !== null);
  home.collections[0].title = "已改名";
  view.rerender(content(1));
  await manual.findByText("当前分组还没有内容。");
  await waitFor(() => expect(screen.getByRole("button", { name: "打开合集 已改名" })).toHaveFocus());
  expect(manual.getByText("共 0 个")).toBeInTheDocument();
});
