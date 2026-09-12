import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { importedDetail } from "../libraryControllerTestFixtures";
import { CollectionPickerDialog } from "./CollectionPickerDialog";
import type { CollectionOverviewInput } from "../../../generated/collection-overview-input";

function setup(onAdd = vi.fn().mockResolvedValue({})) {
  const onClose = vi.fn();
  const read = vi.fn(async (input: CollectionOverviewInput) => ({ ...input, scope: "collections" as const, snapshotToken: "a".repeat(64),
    totalCount: 2, nextOffset: null, items: [
      { ...importedDetail.summary, id: "target", title: input.rootLinked ? "文件夹目标" : "自建目标", rootId: input.rootLinked ? "root" : null },
      { ...importedDetail.summary, id: "current", title: "当前目标" },
    ] }));
  const view = render(<CollectionPickerDialog projectId="video" projectTitle="测试视频" excludedCollectionId="current"
    onAdd={onAdd} onClose={onClose} readCollections={read} />);
  return { onAdd, onClose, read, unmount: view.unmount };
}
it("preserves both destination types and sends the selected project and collection", async () => {
  const { read, onAdd, onClose } = setup();
  expect(await screen.findByRole("button", { name: "加入「当前目标」" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索合集" }), { target: { value: "  目标  " } });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() => expect(read).toHaveBeenLastCalledWith({ query: "目标", rootLinked: false, offset: 0, expectedSnapshotToken: null }));
  fireEvent.change(screen.getByRole("combobox", { name: "合集类型" }), { target: { value: "true" } });
  fireEvent.click(await screen.findByRole("button", { name: "加入「文件夹目标」" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onAdd).toHaveBeenCalledWith("target", "video");
});
it.each([null, new Error("保存失败")])("keeps the dialog editable after mutation failure", async failure => {
  const onAdd = vi.fn();
  if (failure instanceof Error) onAdd.mockRejectedValueOnce(failure); else onAdd.mockResolvedValueOnce(failure);
  onAdd.mockResolvedValueOnce({});
  const { onClose } = setup(onAdd);
  fireEvent.click(await screen.findByRole("button", { name: "加入「自建目标」" }));
  await screen.findByRole("alert");
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "搜索合集" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "加入「自建目标」" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
it("prevents duplicate adds and ignores completion after the picker closes", async () => {
  let finish!: (result: object) => void;
  const onAdd = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const { onClose, unmount } = setup(onAdd);
  const target = await screen.findByRole("button", { name: "加入「自建目标」" });
  fireEvent.click(target); fireEvent.click(target);
  expect(onAdd).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: "搜索合集" })).toBeDisabled();
  unmount();
  await act(async () => { finish({}); });
  expect(onClose).not.toHaveBeenCalled();
});
