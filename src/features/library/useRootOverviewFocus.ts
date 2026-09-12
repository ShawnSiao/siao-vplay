import { useEffect, useRef, type FocusEvent } from "react";
import type { RootOverviewPage } from "../../generated/root-overview-page";

export function useRootOverviewFocus(page: RootOverviewPage | null, loading: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const previousOffset = useRef<number | null>(null);
  const focusedRoot = useRef<string | null>(null);
  useEffect(() => {
    if (!page || loading) return;
    const changed = previousOffset.current !== null && previousOffset.current !== page.offset;
    const removed = focusedRoot.current !== null && !page.items.some(item => item.id === focusedRoot.current);
    previousOffset.current = page.offset;
    if (removed) focusedRoot.current = null;
    const localFocus = document.activeElement === document.body || root.current?.contains(document.activeElement);
    if ((changed && localFocus) || (removed && document.activeElement === document.body)) {
      const target = root.current?.querySelector<HTMLButtonElement>(".library-folder-row button:not(:disabled)") ?? root.current;
      target?.focus({ preventScroll: true });
      root.current?.scrollIntoView?.({ block: "start" });
    }
  }, [page, loading]);
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    focusedRoot.current = (event.target as HTMLElement).closest<HTMLElement>("[data-root-id]")?.dataset.rootId ?? null;
  };
  return { root, onFocusCapture };
}
