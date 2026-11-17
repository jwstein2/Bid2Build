"use client";
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

/** Fired when any lightweight popover opens, so the others close (one open at a time). */
const OPEN_EVENT = "b2b:popover-open";

interface DismissOptions {
  /** Elements that count as "inside" (trigger + panel). A pointer down anywhere else closes. */
  inside: RefObject<HTMLElement | null>[];
  /** Where focus goes after Escape (usually the trigger). */
  returnFocus?: RefObject<HTMLElement | null>;
  /** Set false for panels that hold unsaved input and must not close on an outside click. */
  closeOnOutside?: boolean;
}

/**
 * Shared close behavior for the app's lightweight (non-modal) popovers and menus: a pointer down
 * outside closes, Escape closes and returns focus to the trigger, and opening one popover closes any
 * other. The outside click is not swallowed, so the thing you clicked still works. Radix menus and
 * dialogs handle this themselves; use this only for hand-rolled panels.
 */
export function useDismiss(open: boolean, close: () => void, { inside, returnFocus, closeOnOutside = true }: DismissOptions) {
  const id = useId();
  const latest = useRef({ close, inside, returnFocus, closeOnOutside });
  useEffect(() => { latest.current = { close, inside, returnFocus, closeOnOutside }; });
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    const onOther = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) latest.current.close(); };
    const onDown = (e: PointerEvent) => {
      const l = latest.current;
      if (!l.closeOnOutside) return;
      const t = e.target as Node | null;
      if (t && l.inside.some((r) => r.current?.contains(t))) return;
      // A Radix dialog or menu opened from inside this popover lives in a portal: leave it alone.
      const layer = t instanceof Element ? t.closest("[data-radix-popper-content-wrapper],[role=dialog],[role=alertdialog]") : null;
      if (layer && !l.inside.some((r) => r.current && layer.contains(r.current))) return;
      l.close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const l = latest.current;
      l.close();
      l.returnFocus?.current?.focus();
    };
    window.addEventListener(OPEN_EVENT, onOther);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOther);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, id]);
}

/**
 * Arrow-key movement between the items of a simple menu (Up/Down/Home/End). Attach to the menu
 * container's onKeyDown; items are its enabled buttons and links.
 */
export function menuKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("a[href],button:not([disabled])")];
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[next]?.focus();
}
