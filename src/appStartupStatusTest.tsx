import { render, screen } from "@testing-library/react";
import { expect, type Mock } from "vitest";
import App from "./App";
export async function verifyRejectedStartupStatus(mocks: Record<"getAppStatus" | "openLocalProject", Mock>) {
  mocks.getAppStatus.mockRejectedValue(new Error("应用启动状态不完整或不兼容，请重新启动应用。"));
  render(<App />);
  expect(await screen.findByText("应用启动信息读取失败，请重新启动应用。")).toBeInTheDocument();
  expect(mocks.openLocalProject).not.toHaveBeenCalled();
}
