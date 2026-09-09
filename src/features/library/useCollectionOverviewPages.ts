import { useCallback, useEffect, useRef, useState } from "react";
import { commandError } from "../../lib/desktop";
import { readCollectionOverview } from "../../lib/libraryOverviewGateway";
import type { CollectionOverviewInput } from "../../generated/collection-overview-input";
import type { CollectionOverviewPage } from "../../generated/collection-overview-page";

export type CollectionOverviewReader = typeof readCollectionOverview;
const initialInput: CollectionOverviewInput = { rootLinked: false, query: "", offset: 0, expectedSnapshotToken: null };
type State = { input: CollectionOverviewInput; page: CollectionOverviewPage | null; loading: boolean; error: string | null; pageSize: number };

export function useCollectionOverviewPages(read: CollectionOverviewReader = readCollectionOverview) {
  const [state, setState] = useState<State>({ input: initialInput, page: null, loading: true, error: null, pageSize: 0 });
  const sequence = useRef(0);
  const load = useCallback(async (input: CollectionOverviewInput) => {
    const request = ++sequence.current;
    setState(old => ({ ...old, input, loading: true, error: null,
      page: input.expectedSnapshotToken === null ? null : old.page }));
    try {
      const page = await read(input);
      if (request !== sequence.current) return false;
      setState(old => ({ input, page, loading: false, error: null,
        pageSize: input.offset === 0 ? page.items.length : old.pageSize }));
      return true;
    } catch (error) {
      if (request !== sequence.current) return false;
      setState(old => ({ ...old, loading: false, error: commandError(error).message }));
      return false;
    }
  }, [read]);
  useEffect(() => {
    void load(initialInput);
    return () => { sequence.current += 1; };
  }, [load]);
  const search = (query: string, rootLinked: boolean) => load({ ...initialInput, query, rootLinked });
  const move = (offset: number) => state.page && !state.loading
    ? load({ ...state.input, offset, expectedSnapshotToken: state.page.snapshotToken }) : Promise.resolve(false);
  return { ...state, search,
    next: () => state.page?.nextOffset != null ? move(state.page.nextOffset) : Promise.resolve(false),
    previous: () => move(Math.max(0, (state.page?.offset ?? 0) - state.pageSize)),
    retry: () => load(state.input),
    reload: () => search(state.input.query, state.input.rootLinked),
  };
}
