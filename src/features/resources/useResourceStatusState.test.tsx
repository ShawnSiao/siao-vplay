import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { setupStatus } from "../../test-fixtures/localResources";
import { useResourceStatusState } from "./useResourceStatusState";
it("adopts only newer snapshots, including changed roots, and ignores duplicate revisions", () => {
  const { result } = renderHook(() => useResourceStatusState());
  expect(result.current.status).toBeNull();
  const first = { ...setupStatus, snapshotRevision: 2 };
  act(() => result.current.setStatus(first));
  act(() => result.current.setStatus({ ...first, preferredProfile: "ignored" }));
  expect(result.current.status).toBe(first);
  const newer = { ...setupStatus, snapshotRevision: 3, resourceRoot: "W:\\NewRoot" };
  act(() => result.current.setStatus(newer));
  act(() => result.current.setStatus(first));
  expect(result.current.status).toBe(newer);
});
