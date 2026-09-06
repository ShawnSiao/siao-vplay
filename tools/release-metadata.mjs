import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function validateMetadata(meta) {
  if (meta.schemaVersion !== 1 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(meta.version ?? "")) {
    throw new Error("Invalid release metadata version");
  }
  if (!["development", "beta", "stable"].includes(meta.channel)) throw new Error("Invalid release channel");
  if (meta.channel === "stable" && meta.version.includes("-")) throw new Error("Stable versions cannot have prerelease identifiers");
  for (const key of ["nodeVersion", "rustVersion"]) {
    if (!/^\d+\.\d+\.\d+$/.test(meta[key] ?? "")) throw new Error("Invalid toolchain version: " + key);
  }
  if (meta.releasesUrl !== meta.repository + "/releases" || !meta.repository.startsWith("https://github.com/")) {
    throw new Error("Release URL must belong to the repository");
  }
  if (!Array.isArray(meta.platforms) || !meta.platforms.length) throw new Error("Missing release platforms");
  return meta;
}

export function versionMismatches(meta, versions) {
  return Object.entries(versions).filter(([, value]) => value !== meta.version).map(([name]) => name);
}

export function checkRelease(root, sync = false) {
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  const json = (path) => JSON.parse(read(path));
  const save = (path, value) => writeFileSync(resolve(root, path), JSON.stringify(value, null, 2) + "\n");
  const meta = validateMetadata(json("release.json"));
  const licenses = [
    ["LICENSE", "src-tauri/resources/third-party-notices/SiaoVPlay-MIT.txt"],
    ["src/assets/ai-service-logos/LICENSE", "src-tauri/resources/third-party-notices/LobeHub-MIT.txt"],
  ];
  for (const [source, target] of licenses) {
    const expected = read(source).replace(/\r\n/g, "\n");
    if (sync) writeFileSync(resolve(root, target), expected);
    else if (read(target).replace(/\r\n/g, "\n") !== expected) throw new Error("Bundled license differs from " + source);
  }
  const pkg = json("package.json"), lock = json("package-lock.json"), tauri = json("src-tauri/tauri.conf.json");
  let cargo = read("src-tauri/Cargo.toml");
  if (sync) {
    pkg.version = lock.version = lock.packages[""].version = tauri.version = meta.version;
    pkg.engines = { ...pkg.engines, node: meta.nodeVersion };
    lock.packages[""].engines = pkg.engines;
    lock.packages[""].license = pkg.license;
    cargo = cargo.replace(/^(version\s*=\s*")[^"]+(")/m, "$1" + meta.version + "$2");
    save("package.json", pkg); save("package-lock.json", lock); save("src-tauri/tauri.conf.json", tauri);
    writeFileSync(resolve(root, "src-tauri/Cargo.toml"), cargo);
    const cargoLock = read("src-tauri/Cargo.lock").replace(
      /(\[\[package\]\]\s+name = "siao-vplay"\s+version = ")[^"]+(")/,
      "$1" + meta.version + "$2",
    );
    writeFileSync(resolve(root, "src-tauri/Cargo.lock"), cargoLock);
    writeFileSync(resolve(root, ".node-version"), meta.nodeVersion + "\n");
    const toolchain = read("rust-toolchain.toml").replace(/^(channel\s*=\s*")[^"]+(")/m, "$1" + meta.rustVersion + "$2");
    writeFileSync(resolve(root, "rust-toolchain.toml"), toolchain);
  }
  const versions = {
    npm: pkg.version, npmLock: lock.version, npmRoot: lock.packages[""].version,
    tauri: tauri.version, cargo: cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    cargoLock: read("src-tauri/Cargo.lock").match(/\[\[package\]\]\s+name = "siao-vplay"\s+version = "([^"]+)"/)?.[1],
  };
  const mismatches = versionMismatches(meta, versions);
  if (mismatches.length) throw new Error("Version mismatch: " + mismatches.join(", ") + ". Run npm run release:sync.");
  if (read(".node-version").trim() !== meta.nodeVersion || pkg.engines?.node !== meta.nodeVersion ||
      read("rust-toolchain.toml").match(/^channel\s*=\s*"([^"]+)"/m)?.[1] !== meta.rustVersion) {
    throw new Error("Toolchain metadata is inconsistent");
  }
  return meta;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const meta = checkRelease(root, process.argv.includes("--sync"));
  console.log("Release metadata verified: " + meta.version + " (" + meta.channel + ")");
}
