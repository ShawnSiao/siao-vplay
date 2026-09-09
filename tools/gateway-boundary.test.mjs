import { ESLint } from "eslint";
import { test } from "node:test";
import assert from "node:assert/strict";
const eslint = new ESLint();
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
