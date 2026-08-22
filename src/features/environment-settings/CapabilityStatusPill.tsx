import type { LocalResourceCapabilityStatus } from "../../types";
import { capabilityStateLabel } from "./localResourcePresentation";

type CapabilityStatusPillProps = {
  capability: LocalResourceCapabilityStatus;
  installable: boolean;
  busy: boolean;
  previewMode: boolean;
  onUpdate: () => void;
};

export function CapabilityStatusPill({
  capability,
  installable,
  busy,
  previewMode,
  onUpdate,
}: CapabilityStatusPillProps) {
  if (capability.state === "update_available") {
    return (
      <button
        aria-label={`更新${capability.title}`}
        className="status-pill warning status-pill-action"
        type="button"
        disabled={previewMode || busy}
        onClick={onUpdate}
      >
        {busy ? "更新中…" : capabilityStateLabel(capability, installable)}
      </button>
    );
  }
  return (
    <span
      className={`status-pill ${capability.state === "ready" ? "ready" : "warning"}`}
    >
      {capabilityStateLabel(capability, installable)}
    </span>
  );
}
