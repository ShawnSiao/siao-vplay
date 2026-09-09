import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createDeferredDialog } from "./createDeferredDialog";
import { Dialog } from "./Dialog";

function Loaded({ onClose, name }: { onClose: () => void; name: string }) {
  return <Dialog title={name} onClose={onClose}><input aria-label="草稿" defaultValue="" /></Dialog>;
}

it("loads only on demand and retains the mounted dialog draft across parent updates", async () => {
  let finish!: (component: typeof Loaded) => void;
  const load = vi.fn(() => new Promise<typeof Loaded>(resolve => { finish = resolve; }));
  const Deferred = createDeferredDialog(load, "设置");
  expect(load).not.toHaveBeenCalled();
  const close = vi.fn();
  const view = render(<Deferred onClose={close} name="设置" />);
  expect(screen.getByRole("status")).toHaveTextContent("正在打开");
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  await act(async () => finish(Loaded));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "未保存" } });
  view.rerender(<Deferred onClose={close} name="设置更新" />);
  expect(screen.getByRole("textbox")).toHaveValue("未保存");
  expect(load).toHaveBeenCalledTimes(1);
});

it("contains import failure without discarding the app or promising a cached-import retry", async () => {
  const load = vi.fn<() => Promise<typeof Loaded>>().mockRejectedValue(new Error("private path"));
  const close = vi.fn();
  const Deferred = createDeferredDialog(load, "设置");
  render(<Deferred onClose={close} name="设置" />);
  const alert = await screen.findByRole("alert");
  expect(alert).not.toHaveTextContent("private path");
  expect(alert).toHaveTextContent("保存当前工作后重启应用");
  expect(screen.queryByRole("button", { name: "重新加载" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
});

it("ignores completion after close and reuses the loaded component when reopened", async () => {
  let finish!: (component: typeof Loaded) => void;
  const load = vi.fn(() => new Promise<typeof Loaded>(resolve => { finish = resolve; }));
  const Deferred = createDeferredDialog(load, "设置");
  const first = render(<Deferred onClose={vi.fn()} name="设置" />);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  first.unmount();
  await act(async () => finish(Loaded));
  expect(screen.queryByRole("dialog")).toBeNull();
  render(<Deferred onClose={vi.fn()} name="设置" />);
  expect(screen.getByRole("textbox")).toBeVisible();
  expect(load).toHaveBeenCalledTimes(1);
});
