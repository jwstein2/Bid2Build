"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LineItem } from "@/lib/estimate/types";
import { EMPTY_LIBRARY, findSameItem, savedItemFromLine, type LibraryData, type LibraryOp, type SavedItem, type SavedStack } from "@/lib/library/saved-items";

export type { SavedItem, SavedStack } from "@/lib/library/saved-items";

export type LibraryResult = { ok: true } | { ok: false; code: string; message: string };

const PREMIUM: LibraryResult = { ok: false, code: "premium_required", message: "Saved Items are part of Unlimited." };

/**
 * Premium Saved Items & Pricing Library for the signed-in contractor. Signed-out visitors and free
 * accounts get `access: false` (the server decides); every write is re-checked by the API and RLS.
 */
export function useLibrary(signedIn: boolean) {
  const [lib, setLib] = useState<LibraryData>(EMPTY_LIBRARY);
  const [loaded, setLoaded] = useState(false);
  const libRef = useRef(lib);
  useEffect(() => { libRef.current = lib; }, [lib]);

  const reload = useCallback(async () => {
    if (!signedIn) { setLib(EMPTY_LIBRARY); setLoaded(true); return; }
    try {
      const r = await fetch("/api/library", { cache: "no-store" });
      if (r.ok) setLib((await r.json()) as LibraryData);
    } catch { /* keep what we have */ }
    setLoaded(true);
  }, [signedIn]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!signedIn) { if (!cancelled) { setLib(EMPTY_LIBRARY); setLoaded(true); } return; }
      try {
        const r = await fetch("/api/library", { cache: "no-store" });
        if (r.ok && !cancelled) setLib((await r.json()) as LibraryData);
      } catch { /* offline: library stays empty */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [signedIn]);

  /** Optimistic update, rolled back if the server refuses. */
  const run = useCallback(async (next: LibraryData, op: LibraryOp): Promise<LibraryResult> => {
    const prev = libRef.current;
    if (!prev.access && op.action !== "remove") return PREMIUM;
    libRef.current = next;
    setLib(next);
    try {
      const r = await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) });
      if (r.ok) return { ok: true };
      const d = (await r.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const back = r.status === 402 ? { ...prev, access: false } : prev;
      libRef.current = back;
      setLib(back);
      return { ok: false, code: d?.error?.code ?? "save_failed", message: d?.error?.message ?? "Could not update your Saved Items." };
    } catch {
      libRef.current = prev;
      setLib(prev);
      return { ok: false, code: "network", message: "You're offline. Your Saved Items were not changed." };
    }
  }, []);

  const addItem = (s: SavedItem) => run({ ...libRef.current, items: [s, ...libRef.current.items] }, { kind: "item", action: "add", payload: s });
  const updateItem = (s: SavedItem) =>
    run({ ...libRef.current, items: libRef.current.items.map((x) => (x.id === s.id ? s : x)) }, { kind: "item", action: "update", payload: s });
  const removeItem = (id: string) => run({ ...libRef.current, items: libRef.current.items.filter((x) => x.id !== id) }, { kind: "item", action: "remove", payload: { id } });

  /** "Save Item" on an estimate row: updates the saved item with the same name in the same trade, otherwise adds one. */
  const saveLine = (it: LineItem, ctx: { trade?: string | null; category?: string | null }): Promise<LibraryResult & { updated?: boolean }> => {
    const existing = findSameItem(libRef.current.items, { name: it.name, trade: ctx.trade ?? null });
    const s = savedItemFromLine(it, ctx, existing?.id ?? crypto.randomUUID());
    return existing
      ? updateItem({ ...s, category: s.category ?? existing.category }).then((r) => ({ ...r, updated: true }))
      : addItem(s);
  };

  /** "Save Stack": a reusable collection of rows (with quantities), kept in order. */
  const saveStack = (name: string, items: LineItem[], trade: string | null) => {
    const stack: SavedStack = {
      id: crypto.randomUUID(), name: name.trim(), trade,
      items: items.map((it) => ({ ...savedItemFromLine(it, { trade }, crypto.randomUUID()), quantity: it.quantity.trim() || "1" })),
    };
    return run({ ...libRef.current, stacks: [stack, ...libRef.current.stacks] }, { kind: "stack", action: "add", payload: stack });
  };
  const renameStack = (id: string, name: string) =>
    run({ ...libRef.current, stacks: libRef.current.stacks.map((x) => (x.id === id ? { ...x, name } : x)) }, { kind: "stack", action: "rename", payload: { id, name } });
  const removeStack = (id: string) => run({ ...libRef.current, stacks: libRef.current.stacks.filter((x) => x.id !== id) }, { kind: "stack", action: "remove", payload: { id } });

  return { ...lib, signedIn, loaded, reload, addItem, updateItem, removeItem, saveLine, saveStack, renameStack, removeStack };
}

export type Library = ReturnType<typeof useLibrary>;
