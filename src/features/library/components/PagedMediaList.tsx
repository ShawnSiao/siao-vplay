import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LibraryMediaSummary } from "../../../types";
import type { LibraryCollectionPagination } from "../useLibraryCollectionPaging";
import { libraryViewPolicy } from "../libraryViewPolicy";
import { MediaPageFooter } from "./MediaPageFooter";

type Props = { contentKind?: "episodes" | "videos"; items: LibraryMediaSummary[]; page?: LibraryCollectionPagination; empty: ReactNode;
  renderItem: (media: LibraryMediaSummary) => ReactNode };
export function PagedMediaList({ items, page, empty, renderItem, contentKind }: Props) {
  const [requestedStart, setRequestedStart] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const intent = useRef(0);
  const requestPending = useRef(false);
  const priorStart = useRef(0);
  const focusedProject = useRef<string | null>(null);
  const size = libraryViewPolicy.mediaRenderPageSize;
  const start = Math.min(requestedStart, Math.max(0, Math.floor((items.length - 1) / size) * size));
  const displayStart = (page?.offset ?? 0) + start;
  const visible = items.slice(start, start + size);
  const hasNext = start + size < items.length;
  const pagination = page ?? { totalCount: items.length, nextOffset: null, error: null, loadingMore: false, loadMore: async () => false, reload: () => undefined };
  useEffect(() => () => { intent.current += 1; }, []);
  useLayoutEffect(() => {
    const removedFocus = focusedProject.current !== null && !visible.some(item => item.projectId === focusedProject.current);
    if (removedFocus) focusedProject.current = null;
    const focusIsLocal = document.activeElement === document.body || root.current?.contains(document.activeElement);
    if ((priorStart.current !== displayStart && focusIsLocal) || (removedFocus && document.activeElement === document.body)) {
      const first = root.current?.querySelector<HTMLButtonElement>(".library-media-item button") ?? root.current;
      first?.focus(); first?.scrollIntoView?.({ block: "nearest" });
    }
    priorStart.current = displayStart;
  }, [displayStart, visible]);
  const show = (offset: number) => { intent.current += 1; setRequestedStart(offset); };
  const loadMore = async () => {
    if (requestPending.current) return false;
    requestPending.current = true;
    const current = ++intent.current;
    const next = items.length;
    try {
      const loaded = await pagination.loadMore();
      if (loaded && current === intent.current && page?.offset === undefined) setRequestedStart(Math.floor(next / size) * size);
      return loaded;
    } finally { requestPending.current = false; }
  };
  return <div ref={root} role="group" tabIndex={-1} aria-label={contentKind === "videos" ? "视频列表" : "剧集列表"} onFocusCapture={event => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-project-id]");
    if (row) focusedProject.current = row.dataset.projectId ?? null;
    else if (root.current?.contains(target)) focusedProject.current = null;
  }}>
    {visible.length ? <div className="library-media-list">{visible.map(renderItem)}</div> : pagination.error ? null : empty}
    <MediaPageFooter page={{ ...pagination, nextOffset: hasNext ? null : pagination.nextOffset, loadMore }}
      contentKind={contentKind} count={visible.length} offset={displayStart}
      onPrevious={start ? () => show(Math.max(0, start - size)) : page?.offset && page.loadPrevious ? () => { void page.loadPrevious?.(); } : undefined}
      onNext={hasNext ? () => show(start + size) : undefined} />
  </div>;
}
