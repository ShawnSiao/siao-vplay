import assert from "node:assert/strict";
import test from "node:test";
import { validateMetadata, versionMismatches } from "./release-metadata.mjs";
const base = { schemaVersion: 1, version: "0.4.1", channel: "development", nodeVersion: "24.18.0", rustVersion: "1.97.0",
  repository: "https://github.com/ShawnSiao/siao-vplay", releasesUrl: "https://github.com/ShawnSiao/siao-vplay/releases", platforms: ["windows-11-x64"] };
test("stable channel rejects a prerelease and unknown channels fail", () => {
  assert.throws(() => validateMetadata({ ...base, channel: "stable", version: "1.0.0-beta.1" }));
  assert.throws(() => validateMetadata({ ...base, channel: "published" }));
  assert.equal(validateMetadata({ ...base, channel: "stable" }).version, "0.4.1");
});
test("each consumer of the release version must agree", () => {
  assert.deepEqual(versionMismatches(base, { cargo: "0.4.1", tauri: "0.3.0", npm: undefined }), ["tauri", "npm"]);
});
test("toolchain versions and the destination are validated", () => {
  assert.throws(() => validateMetadata({ ...base, nodeVersion: "latest" }));
  assert.throws(() => validateMetadata({ ...base, releasesUrl: "https://example.com/download" }));
});
