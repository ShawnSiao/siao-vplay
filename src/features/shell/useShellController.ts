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
  | { type: "toggle_navigation" }
  | { type: "toggle_drawer"; tab: ShellDrawerTab }
  | { type: "close_drawer" };

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "set_view":
      return {
        ...state,
        activeView: action.view,
        drawerTab: action.view === "player" ? state.drawerTab : null,
      };
    case "set_navigation_collapsed":
      return { ...state, navigationCollapsed: action.collapsed };
    case "toggle_navigation":
      return { ...state, navigationCollapsed: !state.navigationCollapsed };
    case "toggle_drawer":
      return {
        ...state,
        drawerTab: state.drawerTab === action.tab ? null : action.tab,
      };
    case "close_drawer":
      return { ...state, drawerTab: null };
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
  const toggleDrawer = useCallback((tab: ShellDrawerTab) => {
    dispatch({ type: "toggle_drawer", tab });
  }, []);
  const closeDrawer = useCallback(() => {
    dispatch({ type: "close_drawer" });
  }, []);

  return {
    state,
    setActiveView,
    toggleNavigation,
    toggleDrawer,
    closeDrawer,
  };
}
