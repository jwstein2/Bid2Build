"use client";
import { useEffect, useId } from "react";

/**
 * A tiny registry of "this screen has changes that are not saved to the account yet". The update banner reads it so
 * "Refresh" never throws away an estimate, proposal or note: it asks the person to save first.
 */
const dirty = new Set<string>();

/** The last text field the person typed into. Clicking a button moves focus away, so focus alone isn't enough. */
let lastTyped: WeakRef<HTMLElement> | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && isTextField(t)) lastTyped = new WeakRef(t);
  }, true);
  // A submitted form has been handed to the app.
  document.addEventListener("submit", (e) => {
    const typed = lastTyped?.deref();
    if (typed && e.target instanceof HTMLFormElement && e.target.contains(typed)) lastTyped = null;
  }, true);
}

function isTextField(el: HTMLElement): boolean {
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["button", "submit", "reset", "checkbox", "radio", "file", "hidden", "range", "color"].includes(el.type);
}

function hasText(el: HTMLElement): boolean {
  if (el.isContentEditable) return (el.textContent ?? "").trim().length > 0;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.length > 0 : false;
}

export function hasUnsavedWork(): boolean {
  if (dirty.size > 0) return true;
  if (typeof document === "undefined") return false;
  // Typed into a field that is still on screen and still has text: treat as possibly unsaved.
  const typed = lastTyped?.deref();
  if (typed && typed.isConnected && hasText(typed)) return true;
  const el = document.activeElement as HTMLElement | null;
  return Boolean(el && isTextField(el) && hasText(el));
}

export function setUnsaved(key: string, value: boolean) {
  if (value) dirty.add(key); else dirty.delete(key);
}

/** Mark the calling component's work as unsaved while `value` is true. */
export function useUnsavedWork(value: boolean) {
  const key = useId();
  useEffect(() => {
    setUnsaved(key, value);
    return () => setUnsaved(key, false);
  }, [key, value]);
}
