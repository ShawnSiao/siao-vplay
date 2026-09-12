import source from "../../src-tauri/resources/local-resource-catalog.json";
import type { LocalResourceCatalog } from "../generated/local-resource-catalog";

// Mirror Serde's wire defaults for the developer browser preview. Production IPC
// responses are validated as received and never repaired with these defaults.
export function getBrowserResourceCatalog(): LocalResourceCatalog {
  return structuredClone<LocalResourceCatalog>({
    ...source,
    capabilities: source.capabilities.map(capability => ({ ...{ resourceIds: [], profileIds: [], requiresCapabilityIds: [] }, ...capability })),
    profiles: source.profiles.map(profile => ({ ...{ resourceIds: [] }, ...profile })),
    resources: source.resources.map(resource => ({
      ...{ installedSize: null, expectedDownloadSize: null, sourceCommit: null, patchSha256: null,
        requires: null, distribution: null }, ...resource,
      entrypoints: Object.fromEntries(Object.entries(("entrypoints" in resource ? resource.entrypoints : undefined) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      artifact: "artifact" in resource ? { stripComponents: null, ...resource.artifact } : null,
    })),
  });
}
