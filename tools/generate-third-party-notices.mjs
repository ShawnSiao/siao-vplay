import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const overrides = readJson(resolve(root, "tools/third-party-licenses/overrides.json"));
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--offline", "--filter-platform", "x86_64-pc-windows-msvc", "--format-version", "1", "--manifest-path", resolve(root,"src-tauri/Cargo.toml")], { encoding:"utf8", maxBuffer:32*1024*1024 }));
const entries = [];
for (const pkg of metadata.packages.filter(pkg => pkg.source)) {
  entries.push({ ecosystem:"Rust", name:pkg.name, version:pkg.version, license:pkg.license ?? "", directory:dirname(pkg.manifest_path), explicit:pkg.license_file });
}
const lock = readJson(resolve(root,"package-lock.json"));
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path || pkg.dev || pkg.devOptional) continue;
  const directory=resolve(root,path);
  const manifest=readJson(resolve(directory,"package.json"));
  entries.push({ecosystem:"npm",name:manifest.name,version:manifest.version,license:manifest.license??"",directory});
}
const texts=new Map(),missing=[];
const rows=entries.sort((a,b)=>(a.ecosystem+"/"+a.name+"/"+a.version).localeCompare(b.ecosystem+"/"+b.name+"/"+b.version));
for(const entry of rows){
 let files=readdirSync(entry.directory,{withFileTypes:true})
  .filter(x=>x.isFile() && /^(licen[sc]e|copying|notice)([._-].*)?$/i.test(x.name)).map(x=>resolve(entry.directory,x.name));
 if(entry.explicit){const path=resolve(entry.directory,entry.explicit);if(existsSync(path)&&!files.includes(path))files.push(path);}
 if(!files.length){
  const override=overrides[entry.ecosystem+"/"+entry.name+"@"+entry.version];
  if(override){
   const path=resolve(root,"tools/third-party-licenses",override.file);
   if(createHash("sha256").update(readFileSync(path)).digest("hex")!==override.sha256)throw new Error("Upstream license hash mismatch: "+entry.name);
   files.push(path);
   entry.source=override.source;
  }
 }
 entry.notices=[];
 for(const file of files.sort()){
  const text=readFileSync(file,"utf8").replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/[ \t]+$/gm,"").trim();
  if(!text)continue;
  if(!texts.has(text))texts.set(text,texts.size+1);
  entry.notices.push(texts.get(text));
 }
 if(!entry.notices.length)missing.push({ecosystem:entry.ecosystem,name:entry.name,version:entry.version,license:entry.license});
}
if(missing.length){console.error(JSON.stringify({missingLicenseFiles:missing},null,2));process.exit(1);}
const header="SiaoVPlay dependency notices\n\nRust entries include build and test dependencies resolved by Cargo.lock; npm entries cover production dependencies. Inclusion does not imply every dependency is shipped in the binary. Optional downloaded resources have their own catalog and notices.\n\n";
const inventory=rows.map(x=>x.ecosystem+" / "+x.name+" "+x.version+" / "+x.license+" / notices "+x.notices.join(", ")+(x.source?" / "+x.source:"")).join("\n");
const licenses=[...texts].map(([text,id])=>"\n\n===== Notice "+id+" =====\n\n"+text).join("");
const output=header+inventory+licenses+"\n";
const path=resolve(root,"src-tauri/resources/third-party-notices/DEPENDENCIES.txt");
if(process.argv.includes("--check")){
 if(!existsSync(path)||readFileSync(path,"utf8").replace(/\r\n/g,"\n")!==output)throw new Error("Dependency notices differ; run npm run notices:generate and review.");
}else writeFileSync(path,output);
console.log(JSON.stringify({dependencies:rows.length,uniqueNotices:texts.size,bytes:Buffer.byteLength(output),mode:process.argv.includes("--check")?"check":"generate"}));
