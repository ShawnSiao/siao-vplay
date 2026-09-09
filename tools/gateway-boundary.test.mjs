import { ESLint } from "eslint";
import { test } from "node:test";
import assert from "node:assert/strict";
const eslint = new ESLint();
test("library search lifecycle cannot import its parent controller, UI or transport", async () => {
  for (const filePath of ["src/features/library/useLibrarySearch.ts", "src/features/library/useLibraryFolderScan.ts", "src/features/library/useLibraryFolderImport.ts"]) {
  for (const source of ["./useLibraryController", "../../components/LibraryScreen", "../../lib/desktop", "@tauri-apps/api/core"]) {
    const [result] = await eslint.lintText(`import type { Value } from "${source}"; export type X = Value;`, { filePath });
    assert.ok(result.messages.some(message => message.ruleId === "no-restricted-imports"), source);
  }
  }
});
test("IPC boundary rejects UI and facade dependencies", async () => {
  for (const source of ["../features/subtitle-revision/subtitleMetadata", "../components/Player", "./desktop", "react"]) {
    const [result] = await eslint.lintText(`import type { Value } from "${source}"; export type Test = Value;`, { filePath: "src/lib/testGateway.ts" });
    assert.ok(result.messages.some(message => message.ruleId === "no-restricted-imports"), source);
  }
});
test("IPC boundary permits generated wire contracts", async () => {
  const [result] = await eslint.lintText('import type { Value } from "../generated/contract"; export type Test = Value;', { filePath: "src/lib/testGateway.ts" });
  assert.equal(result.errorCount, 0);
});

test("capability intent ownership rejects presentation and facade dependencies", async () => {
  for (const source of ["../../components/LocalResourcesDialog", "../environment-settings/LocalFeaturesDialog", "../playback/useOpeningIntent", "../../lib/desktop"]) {
    const [result] = await eslint.lintText(`import type { Value } from "${source}"; export type Test = Value;`, { filePath: "src/features/resources/useCapabilityPreparation.ts" });
    assert.ok(result.messages.some(message => message.ruleId === "no-restricted-imports"), source);
  }
});

for (const filePath of ["src/lib/testGateway.ts", "src/lib/newContract.ts", "src/lib/learningResult.ts", "src/lib/desktop.ts", "src/lib/storageDirectoryPicker.ts", "src/lib/nested/helper.ts", "src/types.ts"]) {
  test(`all contract import forms enforce dependency direction: ${filePath}`, async () => {
    for (const statement of [
      'import type { Value } from "../features/learning/types"; export type X = Value;',
      'export type X = import("../features/analysis/types").Value;',
      'export const load = () => import("../components/Player");',
      'export const load = (path: string) => import(path);',
      'export type { Value } from "./desktop";',
      'export type { Value } from "./desktop.js";',
      'export type X = import("react/jsx-runtime").Value;',
      'export const load = () => import("./desktop.js");',
    ]) {
      const [result] = await eslint.lintText(statement, { filePath });
      assert.ok(result.messages.some(message => ["no-restricted-imports", "architecture/ipc-imports"].includes(message.ruleId)), statement);
    }
  });
}

test("inline and dynamic imports permit lower-layer literal dependencies", async () => {
  for (const statement of [
    'export type X = import("../generated/explanation").Explanation;',
    'export const load = () => import("@tauri-apps/api/core");',
  ]) {
    const [result] = await eslint.lintText(statement, { filePath: "src/lib/testGateway.ts" });
    assert.equal(result.errorCount, 0, statement);
  }
});

test("resource location changes cannot use the retired unconfirmed IPC command", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src-tauri/src/ipc_handler.rs", import.meta.url), "utf8");
  const registrations = [...source.matchAll(/tauri::generate_handler!\[([\s\S]*?)\]/g)].flatMap(match =>
    [...match[1].matchAll(/commands::([a-z_]+)/g)].map(entry => entry[1]));
  assert.ok(registrations.includes("configure_local_resource_root"), "confirmed location command must remain registered");
  assert.ok(!registrations.includes("set_runtime_storage_root"), "legacy command bypasses reviewed location confirmation");
});

test("desktop bootstrap installs the reviewed IPC handler", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(source, /mod ipc_handler;/);
  assert.match(source, /\.invoke_handler\(ipc_handler::handler\(\)\)/);
});

test("resource mutations only expose the managed task workflow", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src-tauri/src/ipc_handler.rs", import.meta.url), "utf8");
  const registrations = [...source.matchAll(/tauri::generate_handler!\[([\s\S]*?)\]/g)].flatMap(match =>
    [...match[1].matchAll(/(?:commands|resource_commands)::([a-z_]+)/g)].map(entry => entry[1]));
  for (const command of ["set_preferred_model", "download_runtime_component"]) {
    assert.ok(!registrations.includes(command), `${command} bypasses managed resource preparation`);
  }
  assert.ok(registrations.includes("prepare_local_capability"));
});
