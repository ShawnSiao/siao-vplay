import { useCallback, useEffect, useRef, useState } from "react";
import { commandError } from "../../lib/commandError";
import type { OverviewPageInput } from "../../generated/overview-page-input";

export type OverviewWindow = { items: unknown[]; offset: number; snapshotToken: string; totalCount: number; nextOffset: number | null };
type State<Page> = { page: Page | null; loading: boolean; error: string | null; pageSize: number };

export function useOverviewPages<Page extends OverviewWindow>(read: (input: OverviewPageInput) => Promise<Page>, refreshKey?: unknown) {
  const [state, setState] = useState<State<Page>>({ page: null, loading: true, error: null, pageSize: 0 });
  const sequence = useRef(0);
  const offset = useRef(0);
  const lastInput = useRef<OverviewPageInput | null>(null);
  const reader = useRef(read);
  // null means refreshing the current window with a newly acquired snapshot.
  const load = useCallback(async (input: OverviewPageInput | null) => {
    const request = ++sequence.current;
    lastInput.current = input;
    setState(old => ({ ...old, loading: true, error: null }));
    try {
      let page: Page;
      let pageSize: number | null = null;
      if (input === null) {
        const first = await read({ offset: 0, expectedSnapshotToken: null });
        if (request !== sequence.current) return false;
        pageSize = first.items.length;
        const size = Math.max(1, pageSize);
        const target = Math.min(offset.current, Math.max(0, Math.floor((first.totalCount - 1) / size) * size));
        page = target > 0 ? await read({ offset: target, expectedSnapshotToken: first.snapshotToken }) : first;
      } else {
        page = await read(input);
        if (input.offset === 0) pageSize = page.items.length;
      }
      if (request !== sequence.current) return false;
      offset.current = page.offset;
      setState(old => ({ page, loading: false, error: null, pageSize: pageSize ?? old.pageSize }));
      return true;
    } catch (error) {
      if (request !== sequence.current) return false;
      setState(old => ({ ...old, loading: false, error: commandError(error).message }));
      return false;
    }
  }, [read]);
  useEffect(() => {
    if (reader.current !== read) {
      reader.current = read;
      offset.current = 0;
      setState({ page: null, loading: true, error: null, pageSize: 0 });
    }
    void load(null);
    return () => { sequence.current += 1; };
  }, [load, read, refreshKey]);
  const move = (target: number) => state.page && !state.loading
    ? load({ offset: target, expectedSnapshotToken: state.page.snapshotToken }) : Promise.resolve(false);
  return { ...state,
    next: () => state.page?.nextOffset != null ? move(state.page.nextOffset) : Promise.resolve(false),
    previous: () => move(Math.max(0, (state.page?.offset ?? 0) - state.pageSize)),
    retry: () => load(lastInput.current), reload: () => load(null),
  };
}
