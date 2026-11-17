"use client";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { finAction } from "./fin-client";
import { SortableGrid } from "./sortable-grid";

export interface CardSlot { key: string; visible?: boolean }

/** Saves the person's own layout (scope "user"). quickActions left out keeps their earlier choice. */
export async function saveMyLayout(p: { cards: CardSlot[]; kpis: string[]; quickActions?: string[] | null }): Promise<string | null> {
  const r = await finAction({ action: "save_dashboard", scope: "user", role: null, p });
  return r.ok ? null : r.message;
}

/**
 * "Your cards" on the Financials home: press and hold a card, drag it, let go. The new order is saved for
 * this person only (company-locked cards stay where the company put them). Hidden and essential cards keep
 * their places in the saved layout.
 */
export function ArrangeableCards({ cards, all, kpis, locked }: { cards: { key: string; title: string; node: ReactNode }[]; all: CardSlot[]; kpis: string[]; locked: string[] }) {
  const router = useRouter();
  const commit = async (keys: string[]) => {
    // Put the new order into the shown cards' slots of the full layout; everything else stays put.
    const shown = new Set(keys);
    let i = 0;
    const full = all.map((c) => (shown.has(c.key) ? { key: keys[i++], visible: true } : c));
    const err = await saveMyLayout({ cards: full, kpis });
    if (!err) router.refresh();
    return err;
  };
  return (
    <SortableGrid label="Your cards" testId="fin-cards-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" onCommit={commit}
      items={cards.map((c) => ({ key: c.key, title: c.title, node: c.node, fixed: locked.includes(c.key) }))} />
  );
}

/** Quick actions row: press and hold to drag into a new order (saved as the person's own quick actions). */
export function ArrangeableQuickActions({ actions, cards, kpis }: { actions: { key: string; title: string; node: ReactNode }[]; cards: CardSlot[]; kpis: string[] }) {
  const router = useRouter();
  const commit = async (keys: string[]) => {
    const err = await saveMyLayout({ cards, kpis, quickActions: keys });
    if (!err) router.refresh();
    return err;
  };
  return <SortableGrid label="Quick actions" testId="fin-quick-row" className="flex flex-wrap gap-2" onCommit={commit} items={actions.map((a) => ({ key: a.key, title: a.title, node: a.node }))} />;
}
