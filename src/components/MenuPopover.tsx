import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./MenuPopover.css";

const menuOpenedEvent = "siaovplay:menu-opened";

type MenuPopoverProps = {
  label: string;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  trigger?: ReactNode;
};

export function MenuPopover({
  label,
  children,
  className = "",
  triggerClassName = "",
  panelClassName = "",
  trigger = "•••",
}: MenuPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    const closeOtherMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== menuId) setOpen(false);
    };
    window.addEventListener(menuOpenedEvent, closeOtherMenu);
    return () => window.removeEventListener(menuOpenedEvent, closeOtherMenu);
  }, [menuId]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    const closeFromScroll = (event: Event) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeFromKeyboard, true);
    document.addEventListener("scroll", closeFromScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeFromKeyboard, true);
      document.removeEventListener("scroll", closeFromScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    const nextOpen = !open;
    if (nextOpen) {
      window.dispatchEvent(new CustomEvent(menuOpenedEvent, { detail: menuId }));
    }
    setOpen(nextOpen);
  };

  return (
    <div
      ref={rootRef}
      className={`menu-popover ${className} ${open ? "open" : ""}`.trim()}
    >
      <button
        ref={triggerRef}
        className={`menu-popover-trigger ${triggerClassName}`.trim()}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
      >
        {trigger}
      </button>
      <div
        id={menuId}
        className={`menu-popover-panel ${panelClassName}`.trim()}
        role="menu"
        hidden={!open}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('[role="menuitem"]')) {
            setOpen(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
