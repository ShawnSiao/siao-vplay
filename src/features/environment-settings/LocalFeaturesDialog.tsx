import type { ComponentProps } from "react";

import {
  LocalResourcesDialog,
  type PendingResourceAction,
} from "../../components/LocalResourcesDialog";

export type { PendingResourceAction };

type LocalFeaturesDialogProps = ComponentProps<typeof LocalResourcesDialog>;

/**
 * Compatibility boundary for the existing local-resource experience.
 * The environment settings center can replace this wrapper without making App
 * depend on the legacy dialog implementation.
 */
export function LocalFeaturesDialog(props: LocalFeaturesDialogProps) {
  return <LocalResourcesDialog {...props} />;
}
