import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { RuntimeSettingsDialog } from "../components/RuntimeSettingsDialog";
import type { RuntimeCatalog, RuntimeComponent } from "../types";
import "../styles.css";

function component(
  id: string,
  title: string,
  componentKind: RuntimeComponent["componentKind"],
  expectedSizeBytes: number,
): RuntimeComponent {
  return {
    id,
    title,
    componentKind,
    version: "test",
    available: componentKind === "bundled",
    installedPath: componentKind === "bundled" ? `W:\\SiaoVPlay\\${id}` : null,
    expectedSizeBytes,
    installedSizeBytes: null,
    expectedSha256: "a".repeat(64),
    sourceUrl: "https://example.com/source",
    sourcePage: "https://example.com/source",
    license: "MIT",
    errorMessage: componentKind === "download" ? "尚未下载" : null,
  };
}

const initialCatalog: RuntimeCatalog = {
  settings: {
    storageRoot: null,
    preferredModel: "small",
  },
  components: [
    component("whisper-cpu", "Whisper CPU", "bundled", 0),
    component("whisper-vulkan", "Whisper Vulkan", "bundled", 0),
    component("yt-dlp", "yt-dlp", "bundled", 0),
    component("ffmpeg", "FFmpeg", "download", 105_000_000),
    component("whisper-small", "Whisper Small", "download", 465_000_000),
    component("whisper-base", "Whisper Base", "download", 141_000_000),
  ],
};

export function RuntimeHarness() {
  const [catalog, setCatalog] = useState(initialCatalog);
  return (
    <RuntimeSettingsDialog
      catalog={catalog}
      loading={false}
      previewMode
      onClose={() => undefined}
      onCatalogChange={setCatalog}
      onError={() => undefined}
    />
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Runtime settings test root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <RuntimeHarness />
  </StrictMode>,
);
