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
