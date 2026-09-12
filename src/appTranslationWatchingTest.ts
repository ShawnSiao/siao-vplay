import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

/** Runs after the real App has accepted a newly imported translation result. */
export async function verifyNewTranslationWhileWatching(original: string, translation: string) {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
  await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
  const video = document.querySelector("video")!;
  video.currentTime = 0.5;
  fireEvent.timeUpdate(video);
  fireEvent.change(screen.getByRole("combobox", { name: "字幕显示" }), { target: { value: "bilingual" } });
  expect(await screen.findByText(original)).toBeInTheDocument();
  expect(await screen.findByText(translation)).toBeInTheDocument();
  expect(document.querySelector("video")).toBe(video);
  expect(video.currentTime).toBe(0.5);
  fireEvent.change(screen.getByRole("combobox", { name: "字幕显示" }), { target: { value: "original" } });
  expect(await screen.findByText(original)).toBeInTheDocument();
  expect(screen.queryByText(translation)).toBeNull();
}
