import { useCallback, useEffect, useReducer } from "react";

export type ShellView = "library" | "preparing" | "player";
export type ShellDrawerTab = "episodes" | "understand" | "learn";

type ShellState = {
  activeView: ShellView;
  navigationCollapsed: boolean;
  drawerTab: ShellDrawerTab | null;
  contextMenuOpen: boolean;
  windowMode: "windowed" | "fullscreen";
};

type ShellAction =
  | { type: "set_view"; view: ShellView }
  | { type: "set_navigation_collapsed"; collapsed: boolean }
  | { type: "toggle_navigation" };

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "set_view":
      return { ...state, activeView: action.view };
    case "set_navigation_collapsed":
      return { ...state, navigationCollapsed: action.collapsed };
    case "toggle_navigation":
      return { ...state, navigationCollapsed: !state.navigationCollapsed };
  }
}

export function useShellController(initialView: ShellView = "library") {
  const [state, dispatch] = useReducer(shellReducer, {
    activeView: initialView,
    navigationCollapsed: false,
    drawerTab: null,
    contextMenuOpen: false,
    windowMode: "windowed",
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return undefined;
    }
    const narrowWindow = window.matchMedia("(max-width: 1179px)");
    const synchronizeNavigation = () => {
      if (narrowWindow.matches) {
        dispatch({ type: "set_navigation_collapsed", collapsed: true });
      }
    };
    synchronizeNavigation();
    narrowWindow.addEventListener("change", synchronizeNavigation);
    return () =>
      narrowWindow.removeEventListener("change", synchronizeNavigation);
  }, []);

  const setActiveView = useCallback((view: ShellView) => {
    dispatch({ type: "set_view", view });
  }, []);
  const toggleNavigation = useCallback(() => {
    dispatch({ type: "toggle_navigation" });
  }, []);

  return { state, setActiveView, toggleNavigation };
}
