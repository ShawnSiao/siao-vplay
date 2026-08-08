import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openDialog } = vi.hoisted(() => ({
  openDialog: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialog,
}));

describe("chooseLocalResourceParent", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    openDialog.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("opens the native directory picker at the current resource parent", async () => {
    openDialog.mockResolvedValue("E:\\Local resources");
    const { chooseLocalResourceParent } = await import("./desktop");

    await expect(
      chooseLocalResourceParent("W:\\see-cut-play"),
    ).resolves.toBe("E:\\Local resources");
    expect(openDialog).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "选择本地功能资源保存位置",
      defaultPath: "W:\\see-cut-play",
    });
  });

  it("keeps the current location when directory selection is cancelled", async () => {
    openDialog.mockResolvedValue(null);
    const { chooseLocalResourceParent } = await import("./desktop");

    await expect(
      chooseLocalResourceParent("W:\\see-cut-play"),
    ).resolves.toBeNull();
  });
});
