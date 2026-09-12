import { useCallback, useRef } from "react";
import { commandError } from "../../lib/commandError";

export type LibraryMutationAction =
  | { type: "mutation_started" }
  | { type: "mutation_finished" }
  | { type: "failed"; message: string };

export function useLibraryMutation(dispatch: (action: LibraryMutationAction) => void, refresh: () => Promise<void>) {
  const busy = useRef(false);
  const runMutation = useCallback(
    async <T,>(operation: () => Promise<T>, apply: (result: T) => void) => {
      if (busy.current) return null;
      busy.current = true;
      try {
        dispatch({ type: "mutation_started" });
        let result: T;
        try { result = await operation(); }
        catch (error) {
          dispatch({ type: "failed", message: commandError(error).message });
          return null;
        }
        try { apply(result); }
        catch (error) {
          dispatch({ type: "failed", message: `操作已完成，但界面更新失败：${commandError(error).message}` });
        }
        void refresh().catch(error => dispatch({ type: "failed", message: `操作已完成，但媒体库刷新失败：${commandError(error).message}` }));
        return result;
      } finally {
        busy.current = false;
        dispatch({ type: "mutation_finished" });
      }
    },
    [dispatch, refresh],
  );

  return runMutation;
}
