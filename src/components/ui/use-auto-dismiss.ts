"use client";
import { useEffect, useRef, useState, type FocusEvent } from "react";

/** How long an Undo toast stays up. Long enough to read and reach the button, short enough not to linger. */
export const UNDO_TOAST_MS = 9000;

/**
 * Auto-dismiss for toasts. `active` is the toast being shown (any value; null/undefined/false means none),
 * and each new value restarts the clock. The timer pauses while the pointer is over the toast or focus
 * is inside it (so someone reaching for Undo, or tabbing to it, is never cut off) and restarts when they
 * leave. Spread the returned handlers onto the toast's outer element.
 */
export function useAutoDismiss(active: unknown, onDismiss: () => void, ms = UNDO_TOAST_MS) {
  const latest = useRef(onDismiss);
  useEffect(() => { latest.current = onDismiss; });
  // Pause flags belong to one toast: a toast that unmounts under the pointer never fires mouseleave,
  // so flags recorded for an earlier toast are ignored rather than pausing the next one forever.
  const [pause, setPause] = useState<{ for: unknown; hover: boolean; focus: boolean }>({ for: null, hover: false, focus: false });
  const paused = pause.for === active && (pause.hover || pause.focus);
  const set = (k: "hover" | "focus", v: boolean) =>
    setPause((p) => ({ hover: false, focus: false, ...(p.for === active ? p : {}), for: active, [k]: v }));

  useEffect(() => {
    if (active == null || active === false || paused) return;
    const t = setTimeout(() => latest.current(), ms);
    return () => clearTimeout(t);
  }, [active, paused, ms]);

  return {
    onMouseEnter: () => set("hover", true),
    onMouseLeave: () => set("hover", false),
    onFocus: () => set("focus", true),
    onBlur: (e: FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) set("focus", false); },
  };
}
