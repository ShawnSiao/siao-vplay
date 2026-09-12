import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";

// Manual activation keeps arrow-key exploration from starting loads or leaving drafts.
export function useTabNavigation<T extends string>(active: T, onSelect: (id: T) => void) {
  const [navigation, setNavigation] = useState({ active, focused: active });
  if (navigation.active !== active) setNavigation({ active, focused: active });
  const focused = navigation.active === active ? navigation.focused : active;
  const setFocused = (id: T) => setNavigation({ active, focused: id });
  const idPrefix = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.isDefaultPrevented() || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const current = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="tab"]') : null;
    if (!current || current.closest('[role="tablist"]') !== event.currentTarget) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .filter((item) => !item.matches(":disabled") && !item.closest("[hidden], [inert]") && item.closest('[role="tablist"]') === event.currentTarget);
    const index = items.indexOf(current as HTMLButtonElement);
    if (index < 0) return;
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index + items.length - 1) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault(); event.stopPropagation(); items[next].focus();
  };
  return {
    listProps: { role: "tablist" as const, onKeyDown, onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(active);
    } },
    panelProps: { role: "tabpanel" as const, tabIndex: 0, id: `${idPrefix}-panel`, "aria-labelledby": `${idPrefix}-${active}` },
    tabProps: (id: T) => ({ id: `${idPrefix}-${id}`, "aria-controls": `${idPrefix}-panel`, role: "tab" as const, type: "button" as const, "aria-selected": active === id,
      tabIndex: focused === id ? 0 : -1, onFocus: () => setFocused(id), onClick: () => onSelect(id) }),
  };
}
