"use client";
import { useCallback, useEffect, useState } from "react";
import type { LineItem } from "@/lib/estimate/types";

/** Favorites and assemblies. Stored in the cloud for signed-in users, in the browser otherwise. */
export interface SavedItem {
  id: string;
  name: string;
  description?: string;
  costType: LineItem["costType"];
  treatment: LineItem["treatment"];
  unit: string;
  unitCost: string;
  taxable: boolean;
}
export interface Assembly {
  id: string;
  name: string;
  items: (SavedItem & { quantity: string })[];
}
interface Library { items: SavedItem[]; assemblies: Assembly[] }

const KEY = "byb:library";
const readLocal = (): Library => {
  try { return JSON.parse(localStorage.getItem(KEY) || "") as Library; } catch { return { items: [], assemblies: [] }; }
};
const writeLocal = (l: Library) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* ignore */ } };

export function useLibrary(signedIn: boolean) {
  const [lib, setLib] = useState<Library>({ items: [], assemblies: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (signedIn) {
        try {
          const r = await fetch("/api/library", { cache: "no-store" });
          if (r.ok) { const data = (await r.json()) as Library; if (!cancelled) setLib(data); return; }
        } catch { /* fall back */ }
      }
      if (!cancelled) setLib(readLocal());
    })();
    return () => { cancelled = true; };
  }, [signedIn]);

  const persist = useCallback(async (next: Library, op: { kind: "item" | "assembly"; action: "add" | "remove"; payload: unknown }) => {
    setLib(next);
    if (signedIn) {
      await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) }).catch(() => {});
    } else writeLocal(next);
  }, [signedIn]);

  const saveItem = (it: LineItem) => {
    const s: SavedItem = { id: crypto.randomUUID(), name: it.name, description: it.description, costType: it.costType, treatment: it.treatment, unit: it.unit, unitCost: it.unitCost, taxable: it.taxable };
    return persist({ ...lib, items: [s, ...lib.items.filter((x) => x.name.toLowerCase() !== s.name.toLowerCase())] }, { kind: "item", action: "add", payload: s });
  };
  const removeItem = (id: string) => persist({ ...lib, items: lib.items.filter((x) => x.id !== id) }, { kind: "item", action: "remove", payload: { id } });
  const saveAssembly = (name: string, items: LineItem[]) => {
    const a: Assembly = {
      id: crypto.randomUUID(), name,
      items: items.map((it) => ({ id: crypto.randomUUID(), name: it.name, description: it.description, costType: it.costType, treatment: it.treatment, unit: it.unit, unitCost: it.unitCost, taxable: it.taxable, quantity: it.quantity })),
    };
    return persist({ ...lib, assemblies: [a, ...lib.assemblies] }, { kind: "assembly", action: "add", payload: a });
  };
  const removeAssembly = (id: string) => persist({ ...lib, assemblies: lib.assemblies.filter((x) => x.id !== id) }, { kind: "assembly", action: "remove", payload: { id } });

  return { ...lib, saveItem, removeItem, saveAssembly, removeAssembly };
}
