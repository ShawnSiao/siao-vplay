import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

export async function confirmProjectDeletion(title: string, assertDispatched: () => void) {
  fireEvent.click(await screen.findByRole("button", { name: "媒体库：未分类视频" }));
  fireEvent.click(await screen.findByLabelText(`${title} 的更多操作`));
  fireEvent.click(await screen.findByRole("menuitem", { name: "删除视频" }));
  expect(await screen.findByRole("heading", { name: "删除这个本地项目？" })).toBeInTheDocument();
  expect(screen.getByText("源视频不会被删除")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "删除项目" }));
  await waitFor(assertDispatched);
}
