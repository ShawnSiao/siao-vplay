import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDeferredBuild } from "./check-deferred-build.mjs";

test("allows deferred features with shared dependencies and cyclic imports", () => {
  const manifest = { main: { file: "main.js", imports: ["shared"], dynamicImports: ["settings"] },
    shared: { file: "shared.js", imports: ["main"] }, settings: { file: "settings.js", imports: ["shared"] } };
  assert.deepEqual(checkDeferredBuild(manifest, "main", ["settings"]), ["main.js", "shared.js"]);
});
test("rejects missing features and indirect eager imports", () => {
  assert.throws(() => checkDeferredBuild({ main: { file: "main.js" } }, "main", ["settings"]), /Missing deferred feature/);
  assert.throws(() => checkDeferredBuild({ main: { file: "main.js", imports: ["shared"] }, shared: { file: "shared.js", imports: ["settings"] }, settings: { file: "settings.js" } }, "main", ["settings"]), /eagerly loaded/);
});
