"use client";
import { useState, type Dispatch, type ReactNode } from "react";
import type { Estimate } from "@/lib/estimate/types";
import { tradeContents } from "@/lib/estimate/trades";
import { tradeName, trades } from "@/lib/trades/catalog";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { Modal } from "./dialogs";
import type { Action } from "./state";

/**
 * "+ Add trade" picker. Used on the project step and in the estimate, and both dispatch the same
 * action, so adding a trade in either place updates the trade list AND creates the trade's sections.
 */
export function AddTradeSelect({ estimate, dispatch, className, label = "+ Add trade" }: { estimate: Estimate; dispatch: Dispatch<Action>; className?: string; label?: string }) {
  const options = trades.filter((t) => !estimate.trades.includes(t.slug));
  if (!options.length || estimate.trades.length >= 20) return null;
  return (
    <select
      aria-label="Add a trade to this project"
      className={cn("field field-sm w-auto", className)}
      value=""
      onChange={(ev) => ev.target.value && dispatch({ type: "addTrade", trade: ev.target.value })}
    >
      <option value="">{label}</option>
      {options.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
    </select>
  );
}

/**
 * Removing a trade. A trade whose sections are still empty template sections is removed at once
 * (undo is offered). If any section holds entered work, the contractor confirms first and can keep
 * those sections under another trade instead. Estimate data is never deleted silently.
 */
export function useTradeRemoval(estimate: Estimate, dispatch: Dispatch<Action>): { requestRemove: (slug: string) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<string | null>(null);
  const requestRemove = (slug: string) => {
    if (estimate.trades.length < 2) return;
    if (tradeContents(estimate, slug).hasData) setPending(slug);
    else dispatch({ type: "removeTrade", trade: slug });
  };
  const contents = pending ? tradeContents(estimate, pending) : null;
  const others = pending ? estimate.trades.filter((t) => t !== pending) : [];
  const [keepIn, setKeepIn] = useState<string>("");
  const target = others.includes(keepIn) ? keepIn : others[0];
  const close = () => { setPending(null); setKeepIn(""); };

  const dialog = (
    <Modal
      open={Boolean(pending)}
      onOpenChange={(o) => { if (!o) close(); }}
      title={pending ? `Remove ${tradeName(pending)}?` : "Remove trade?"}
      description="This trade's estimate sections have work in them."
    >
      {pending && contents && (
        <div className="space-y-4 text-sm">
          <p className="rounded-lg border border-warn/30 bg-warn-tint px-3 py-2 text-ink">
            {contents.sections} {contents.sections === 1 ? "section" : "sections"} with {contents.items} {contents.items === 1 ? "line item" : "line items"} will be deleted from this estimate and the proposal. Other trades are not affected.
          </p>
          {others.length > 0 && (
            <div className="rounded-lg border border-line p-3">
              <p className="font-semibold">Keep the work instead?</p>
              <p className="mt-0.5 text-ink-soft">Move these sections to another trade and remove only the trade.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {others.length > 1 && (
                  <select aria-label="Trade to keep the sections under" className="field field-sm w-auto" value={target} onChange={(e) => setKeepIn(e.target.value)}>
                    {others.map((t) => <option key={t} value={t}>{tradeName(t)}</option>)}
                  </select>
                )}
                <Button size="sm" variant="secondary" onClick={() => { dispatch({ type: "removeTrade", trade: pending, keepIn: target }); close(); }}>
                  Keep sections under {tradeName(target)}
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="danger" onClick={() => { dispatch({ type: "removeTrade", trade: pending }); close(); }}>Remove trade and its sections</Button>
          </div>
          <p className="text-right text-xs text-muted">You can undo this right after.</p>
        </div>
      )}
    </Modal>
  );
  return { requestRemove, dialog };
}
