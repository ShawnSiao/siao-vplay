import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LibraryMediaSummary } from "../../../types";
import type { LibraryCollectionPagination } from "../useLibraryCollectionPaging";
import { libraryViewPolicy } from "../libraryViewPolicy";
import { CollectionPageFooter } from "./CollectionPageFooter";

type Props = { episodes: LibraryMediaSummary[]; page?: LibraryCollectionPagination; empty: ReactNode;
  renderItem: (media: LibraryMediaSummary) => ReactNode };
export function CollectionEpisodeList({ episodes, page, empty, renderItem }: Props) {
  const [requestedStart, setRequestedStart] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const intent = useRef(0);
  const requestPending = useRef(false);
  const priorStart = useRef(0);
  const size = libraryViewPolicy.collectionRenderPageSize;
  const start = Math.min(requestedStart, Math.max(0, Math.floor((episodes.length - 1) / size) * size));
  const visible = episodes.slice(start, start + size);
  const hasNext = start + size < episodes.length;
  const pagination = page ?? { totalCount: episodes.length, nextOffset: null, error: null, loadingMore: false, loadMore: async () => false, reload: () => undefined };
  useEffect(() => () => { intent.current += 1; }, []);
  useLayoutEffect(() => {
    if (priorStart.current !== start) {
      const first = root.current?.querySelector<HTMLButtonElement>(".library-media-item button");
      first?.focus(); first?.scrollIntoView?.({ block: "nearest" });
      priorStart.current = start;
    }
  }, [start]);
  const show = (offset: number) => { intent.current += 1; setRequestedStart(offset); };
  const loadMore = async () => {
    if (requestPending.current) return false;
    requestPending.current = true;
    const current = ++intent.current;
    const next = episodes.length;
    try {
      const loaded = await pagination.loadMore();
      if (loaded && current === intent.current) setRequestedStart(Math.floor(next / size) * size);
      return loaded;
    } finally { requestPending.current = false; }
  };
  return <div ref={root}>
    {visible.length ? <div className="library-media-list">{visible.map(renderItem)}</div> : pagination.error ? null : empty}
    <CollectionPageFooter page={{ ...pagination, nextOffset: hasNext ? null : pagination.nextOffset, loadMore }}
      count={visible.length} offset={start}
      onPrevious={start ? () => show(Math.max(0, start - size)) : undefined}
      onNext={hasNext ? () => show(start + size) : undefined} />
  </div>;
}
