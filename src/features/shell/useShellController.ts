import { useCallback, useEffect, useReducer } from "react";

export type ShellView = "library" | "preparing" | "player";
export type ShellDrawerTab = "episodes" | "understand" | "learn";
export type ShellContextMenu = { x: number; y: number };

type ShellState = {
  activeView: ShellView;
  navigationCollapsed: boolean;
  drawerTab: ShellDrawerTab | null;
  contextMenu: ShellContextMenu | null;
  windowMode: "windowed" | "fullscreen";
};

type ShellAction =
  | { type: "set_view"; view: ShellView }
  | { type: "set_navigation_collapsed"; collapsed: boolean }
  | { type: "toggle_navigation" }
  | { type: "toggle_drawer"; tab: ShellDrawerTab }
  | { type: "select_drawer"; tab: ShellDrawerTab }
  | { type: "close_drawer" }
  | { type: "open_context_menu"; position: ShellContextMenu }
  | { type: "close_context_menu" };

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "set_view":
      return {
        ...state,
        activeView: action.view,
        drawerTab: action.view === "player" ? state.drawerTab : null,
        contextMenu: null,
      };
    case "set_navigation_collapsed":
      return { ...state, navigationCollapsed: action.collapsed };
    case "toggle_navigation":
      return { ...state, navigationCollapsed: !state.navigationCollapsed };
    case "toggle_drawer":
      return {
        ...state,
        drawerTab: state.drawerTab === action.tab ? null : action.tab,
        contextMenu: null,
      };
    case "select_drawer":
      return { ...state, drawerTab: action.tab, contextMenu: null };
    case "close_drawer":
      return { ...state, drawerTab: null };
    case "open_context_menu":
      return { ...state, contextMenu: action.position };
    case "close_context_menu":
      return { ...state, contextMenu: null };
  }
}

export function useShellController(initialView: ShellView = "library") {
  const [state, dispatch] = useReducer(shellReducer, {
    activeView: initialView,
    navigationCollapsed: false,
    drawerTab: null,
    contextMenu: null,
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
  const selectDrawer = useCallback((tab: ShellDrawerTab) => {
    dispatch({ type: "select_drawer", tab });
  }, []);
  const closeDrawer = useCallback(() => {
    dispatch({ type: "close_drawer" });
  }, []);
  const openContextMenu = useCallback((position: ShellContextMenu) => {
    dispatch({ type: "open_context_menu", position });
  }, []);
  const closeContextMenu = useCallback(() => {
    dispatch({ type: "close_context_menu" });
  }, []);

  return {
    state,
    setActiveView,
    toggleNavigation,
    toggleDrawer,
    selectDrawer,
    closeDrawer,
    openContextMenu,
    closeContextMenu,
  };
}
