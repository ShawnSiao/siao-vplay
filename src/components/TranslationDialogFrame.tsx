import type { ReactNode } from "react";

import { Dialog } from "./Dialog";

type TranslationDialogFrameProps = {
  title: string;
  eyebrow: string;
  embedded: boolean;
  running: boolean;
  busy: boolean;
  actions: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

export function TranslationDialogFrame({
  title,
  eyebrow,
  embedded,
  running,
  busy,
  actions,
  children,
  onClose,
}: TranslationDialogFrameProps) {
  if (embedded) {
    return (
      <div className="translation-embedded">
        {children}
        <div className="translation-embedded-actions">{actions}</div>
      </div>
    );
  }
  return (
    <Dialog
      title={title}
      eyebrow={eyebrow}
      onClose={running ? onClose : busy ? () => undefined : onClose}
      actions={actions}
    >
      {children}
    </Dialog>
  );
}
