"use client";
import { useCallback, useEffect, useState } from "react";

/** Which estimate sections are expanded, plus every section id we have already seen. */
export interface OpenState { open: string[]; known: string[] }

/** First visit: only the first section is open. */
export function initialOpenState(ids: string[]): OpenState {
  return { open: ids.slice(0, 1), known: [...ids] };
}

/**
 * Reconciles saved state with the current section list: drops deleted sections and opens
 * sections that appeared since (the contractor just added them), leaving everything else as it was.
 */
export function reconcileOpenState(prev: OpenState, ids: string[]): OpenState {
  const known = new Set(prev.known);
  const added = ids.filter((id) => !known.has(id));
  const open = prev.open.filter((id) => ids.includes(id)).concat(added);
  if (!added.length && open.length === prev.open.length && prev.known.length === ids.length) return prev;
  return { open, known: [...ids] };
}

export function toggleOpen(prev: OpenState, id: string): OpenState {
  return { ...prev, open: prev.open.includes(id) ? prev.open.filter((x) => x !== id) : [...prev.open, id] };
}

const storageKey = (estimateId: string) => `b2b:open-sections:${estimateId}`;

function readSaved(estimateId: string): OpenState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(estimateId));
    const v = raw ? JSON.parse(raw) : null;
    return v && Array.isArray(v.open) && Array.isArray(v.known) ? v : null;
  } catch { return null; }
}

/**
 * Accordion state for the estimate builder. Collapsing never touches estimate data: sections only
 * hide their rows. Remembered per estimate for this browser tab, so moving between builder steps
 * (or reloading) returns the contractor to the sections they had open.
 */
export function useOpenSections(estimateId: string, ids: string[]) {
  const [state, setState] = useState<OpenState>(() => initialOpenState(ids));
  const idsKey = ids.join(",");

  useEffect(() => {
    const saved = readSaved(estimateId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session storage is only readable after hydration
    if (saved) setState(reconcileOpenState(saved, idsKey ? idsKey.split(",") : []));
  }, [estimateId]); // eslint-disable-line react-hooks/exhaustive-deps -- restore once per estimate

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep state in step with added/removed sections
    setState((s) => reconcileOpenState(s, idsKey ? idsKey.split(",") : []));
  }, [idsKey]);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey(estimateId), JSON.stringify(state)); } catch { /* storage blocked */ }
  }, [estimateId, state]);

  const isOpen = useCallback((id: string) => state.open.includes(id), [state.open]);
  const toggle = useCallback((id: string) => setState((s) => toggleOpen(s, id)), []);
  const setAll = useCallback((open: boolean) => setState((s) => ({ ...s, open: open ? [...s.known] : [] })), []);
  return { isOpen, toggle, setAll };
}
