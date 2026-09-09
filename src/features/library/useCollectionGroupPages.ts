import { useCallback } from "react";
import { readCollectionOverview } from "../../lib/libraryOverviewGateway";
import type { OverviewPageInput } from "../../generated/overview-page-input";
import type { CollectionOverviewReader } from "./useCollectionOverviewPages";
import { useOverviewPages } from "./useOverviewPages";

export function useCollectionGroupPages(rootLinked: boolean, refreshKey?: unknown, read: CollectionOverviewReader = readCollectionOverview) {
  const readPage = useCallback((input: OverviewPageInput) => read({ ...input, rootLinked, query: "" }), [read, rootLinked]);
  return useOverviewPages(readPage, refreshKey);
}
