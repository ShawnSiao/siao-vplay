import { expect, it } from "vitest";
import type { CleanupInterruption } from "../generated/unused-resource-cleanup-result";
import { assertCleanupMatchesPlan, validCleanupOutcome } from "./cleanupOutcome";
const partial: CleanupInterruption = { itemId: "b", message: "locked", remainingItemIds: ["b", "c"] };
it("matches the confirmed completed prefix and not-confirmed remainder", () => {
  expect(validCleanupOutcome(["a"], 3, partial)).toBe(true);
  expect(() => assertCleanupMatchesPlan(["a", "b", "c"], ["a"], partial)).not.toThrow();
  expect(() => assertCleanupMatchesPlan(["a", "b"], ["a", "b"], null)).not.toThrow();
});
it("rejects missing or unrelated items in a cleanup acknowledgement", () => {
  expect(() => assertCleanupMatchesPlan(["a", "b"], ["a"], null)).toThrow();
  expect(() => assertCleanupMatchesPlan(["a", "b"], ["other"], { ...partial, remainingItemIds: ["b"] })).toThrow();
  expect(() => assertCleanupMatchesPlan(["a", "b"], ["a"], { ...partial, remainingItemIds: ["a", "b"] })).toThrow();
});
it("does not attribute reclaimed bytes when no item is confirmed complete", () => {
  expect(validCleanupOutcome([], 1, partial)).toBe(false);
  expect(validCleanupOutcome([], 0, partial)).toBe(true);
});

it("rejects a reordered completed prefix", () => { expect(() => assertCleanupMatchesPlan(["a", "b"], ["b", "a"], null)).toThrow(); });
