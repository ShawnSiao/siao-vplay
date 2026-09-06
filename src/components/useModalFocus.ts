import { useEffect, useLayoutEffect, useRef } from "react";

type Layer = { root: HTMLElement };
const layers: Layer[] = [];
const inertOwners = new Map<Element, { count: number; original: boolean }>();
const top = () => layers.filter((item) => item.root.isConnected).at(-1);
export const isTopModal = (root: HTMLElement | null) => Boolean(root && top()?.root === root);

function isolate(root: HTMLElement) {
  const affected: Element[] = [];
  for (let current: Element | null = root; current?.parentElement; current = current.parentElement) {
    for (const sibling of current.parentElement.children) {
      if (sibling === current) continue;
      const owner = inertOwners.get(sibling) ?? { count: 0, original: sibling.hasAttribute("inert") };
      owner.count += 1;
      inertOwners.set(sibling, owner);
      sibling.setAttribute("inert", "");
      affected.push(sibling);
    }
  }
  return () => {
    for (const element of affected) {
      const owner = inertOwners.get(element);
      if (!owner || --owner.count > 0) continue;
      if (!owner.original) element.removeAttribute("inert");
      inertOwners.delete(element);
    }
  };
}

function visible(element: HTMLElement): boolean {
  if (element.closest("[hidden], [inert]")) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (current instanceof HTMLDetailsElement && !current.open && !current.querySelector("summary")?.contains(element)) return false;
  }
  return true;
}

function tabbable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], summary, [tabindex], [contenteditable=true]"))
    .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && visible(element));
}

/** Shared modal stack for ordinary dialogs and nested storage/settings dialogs. */
export function useModalFocus(onClose: () => void) {
  const rootRef = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = { root };
    // Child effects can mount first; an enclosing modal must remain beneath them.
    const child = layers.findIndex((item) => root.contains(item.root));
    if (child < 0) layers.push(layer); else layers.splice(child, 0, layer);
    const release = isolate(root);
    const focusFirst = () => (tabbable(root)[0] ?? root).focus();
    if (top() === layer) focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (top() !== layer || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); close.current();
      } else if (event.key === "Tab") {
        const items = tabbable(root);
        const first = items[0]; const last = items.at(-1);
        if (!first || !root.contains(document.activeElement)) {
          event.preventDefault(); (event.shiftKey ? last ?? root : first ?? root).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (top() === layer && event.target instanceof Node && !root.contains(event.target)) focusFirst();
    };
    window.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      const wasTop = layers.at(-1) === layer;
      layers.splice(layers.indexOf(layer), 1);
      window.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      release();
      if (wasTop) {
        const remaining = top()?.root;
        if (previous?.isConnected && !previous.closest("[inert]") && (!remaining || remaining.contains(previous))) previous.focus();
        else if (remaining) (tabbable(remaining)[0] ?? remaining).focus();
      }
    };
  }, []);
  return rootRef;
}
