import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const policyPath = path.join(root, "tools", "source-size-policy.json");
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const legacyLimits = new Map(
  Object.entries(policy.legacyLineLimits).map(([file, limit]) => [
    file.replaceAll("\\", "/"),
    Number(limit),
  ]),
);
const extensions = new Set(policy.extensions);
const violations = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(absolute)));
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

for (const sourceRoot of policy.sourceRoots) {
  for (const file of await collect(path.join(root, sourceRoot))) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const contents = await readFile(file, "utf8");
    const lines =
      contents === ""
        ? 0
        : contents.split(/\r?\n/).length - (contents.endsWith("\n") ? 1 : 0);
    const limit = legacyLimits.get(relative) ?? policy.defaultMaxLines;
    if (lines > limit) {
      violations.push(`${relative}: ${lines} lines (limit ${limit})`);
    }
  }
}

if (violations.length > 0) {
  console.error("Source-size policy failed:\n" + violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Source-size policy passed.");
}
