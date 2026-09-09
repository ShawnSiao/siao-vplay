import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { LibraryCollectionPagination } from "../useLibraryCollectionPaging";
import { MediaPageFooter } from "./MediaPageFooter";

export function LibraryContinueWindow({ pagination, count, children }: {
  pagination?: LibraryCollectionPagination; count: number; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previousOffset = useRef(pagination?.offset ?? 0);
  const offset = pagination?.offset ?? 0;
  useLayoutEffect(() => {
    if (offset !== previousOffset.current && (document.activeElement === document.body || root.current?.contains(document.activeElement))) {
      const first = root.current?.querySelector<HTMLButtonElement>(".library-continue-hero button") ?? root.current;
      first?.focus(); first?.scrollIntoView?.({ block: "nearest" });
    }
    previousOffset.current = offset;
  }, [offset]);
  return <div ref={root} tabIndex={-1} role="group" aria-label="继续观看列表">
    {children}
    {pagination ? <MediaPageFooter page={pagination} count={count} offset={offset} contentKind="videos"
      onPrevious={offset > 0 && pagination.loadPrevious ? () => { void pagination.loadPrevious?.(); } : undefined} /> : null}
  </div>;
}
