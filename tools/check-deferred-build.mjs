import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function checkDeferredBuild(manifest, entry, features) {
  function reachable(includeDynamic) {
    const seen = new Set();
    function visit(key) {
      if (seen.has(key)) return;
      if (!manifest[key]) throw new Error(`Missing build manifest entry: ${key}`);
      seen.add(key);
      for (const dependency of manifest[key].imports ?? []) visit(dependency);
      if (includeDynamic) for (const dependency of manifest[key].dynamicImports ?? []) visit(dependency);
    }
    visit(entry);
    return seen;
  }
  const eager = reachable(false);
  const all = reachable(true);
  for (const feature of features) {
    if (!all.has(feature)) throw new Error(`Missing deferred feature: ${feature}`);
    if (eager.has(feature)) throw new Error(`Feature is eagerly loaded: ${feature}`);
  }
  return [...eager].map(key => manifest[key].file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve("dist");
  const manifest = JSON.parse(await readFile(resolve(directory, ".vite/manifest.json"), "utf8"));
  const files = checkDeferredBuild(manifest, "index.html", ["src/features/environment-settings/EnvironmentSettingsDialog.tsx"]);
  const sizes = await Promise.all(files.filter(file => file.endsWith(".js")).map(async file => (await stat(resolve(directory, file))).size));
  console.log(`Deferred feature boundary passed; startup JavaScript: ${sizes.reduce((sum, size) => sum + size, 0)} bytes`);
}
