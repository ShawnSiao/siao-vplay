import { useCallback, useEffect, useRef } from "react";
import { commandError } from "../../lib/commandError";
import type { LibraryHome } from "../../types";
import { getLibraryHome } from "./libraryGateway";

export type LibraryHomeAction =
  | { type: "home_started" }
  | { type: "home_loaded"; home: LibraryHome; sequence: number }
  | { type: "home_failed"; message: string };

export function useLibraryHome(dispatch: (action: LibraryHomeAction) => void) {
  const lifetime = useRef({ sequence: 0, active: false });
  const refresh = useCallback(async () => {
    if (!lifetime.current.active) return;
    const sequence = ++lifetime.current.sequence;
    dispatch({ type: "home_started" });
    try {
      const home = await getLibraryHome();
      if (lifetime.current.sequence === sequence) {
        dispatch({ type: "home_loaded", home, sequence });
      }
    } catch (error) {
      if (lifetime.current.sequence === sequence) {
        dispatch({ type: "home_failed", message: commandError(error).message });
      }
    }
  }, [dispatch]);

  useEffect(() => {
    const state = lifetime.current;
    state.active = true;
    void refresh();
    return () => { state.active = false; state.sequence += 1; };
  }, [refresh]);

  return refresh;
}
