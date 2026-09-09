import { useEffect, useRef, type FocusEvent } from "react";
import type { CollectionOverviewPage } from "../../generated/collection-overview-page";

export function useCollectionGroupFocus(page: CollectionOverviewPage | null, loading: boolean) {
  const root = useRef<HTMLElement>(null);
  const ownsFocus = useRef(false);
  const focusedId = useRef<string | null>(null);
  const priorOffset = useRef<number | null>(null);
  useEffect(() => {
    const observeFocus = (event: globalThis.FocusEvent) => {
      if (event.target !== document.body && !root.current?.contains(event.target as Node)) ownsFocus.current = false;
    };
    const observePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) ownsFocus.current = false;
    };
    document.addEventListener("focusin", observeFocus);
    document.addEventListener("pointerdown", observePointer);
    return () => { document.removeEventListener("focusin", observeFocus); document.removeEventListener("pointerdown", observePointer); };
  }, []);
  useEffect(() => {
    if (!page || loading) return;
    const changed = priorOffset.current !== null && priorOffset.current !== page.offset;
    const removed = focusedId.current !== null && !page.items.some(item => item.id === focusedId.current);
    priorOffset.current = page.offset;
    if (removed) focusedId.current = null;
    if (ownsFocus.current && (changed || removed || document.activeElement === document.body) && (document.activeElement === document.body || root.current?.contains(document.activeElement))) {
      const cards = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(".library-series-tile:not(:disabled)") ?? []);
      const target = (!changed && cards.find(card => card.dataset.collectionId === focusedId.current)) || cards[0] || root.current;
      target?.focus({ preventScroll: true });
      root.current?.scrollIntoView?.({ block: "start" });
    }
  }, [page, loading]);
  const onFocusCapture = (event: FocusEvent<HTMLElement>) => {
    ownsFocus.current = true;
    focusedId.current = (event.target as HTMLElement).closest<HTMLElement>("[data-collection-id]")?.dataset.collectionId ?? null;
  };
  return { root, onFocusCapture };
}
