"use client";
import { useState } from "react";
import { Modal } from "@/components/builder/dialogs";
import { Button } from "@/components/ui/button";
import { deleteWarning, type BoardBid } from "@/lib/pipeline/board";

/**
 * Confirmation before deleting a bid. Deleting hides it from My bids, reports and search, but keeps it on
 * record (who, when and why) so it can be restored from Recently deleted.
 */
export function DeleteDialog({ bid, onCancel, onConfirm }: { bid: BoardBid; onCancel: () => void; onConfirm: (reason: string | undefined) => void }) {
  const [reason, setReason] = useState("");
  const warn = deleteWarning(bid);
  return (
    <Modal open onOpenChange={(o) => { if (!o) onCancel(); }} title="Delete this bid?" description={`${bid.title}${bid.customer ? ` · ${bid.customer}` : ""}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onConfirm(reason.trim() || undefined); }} data-testid="delete-dialog">
        <p className="text-sm text-ink-soft">
          The bid disappears from My bids, reports and search. It isn&apos;t erased: who deleted it and when stays in the audit log, and it can be restored from Recently deleted.
        </p>
        {warn && <p className="rounded-lg border border-warn/30 bg-warn-tint px-3 py-2 text-sm text-ink" role="note" data-testid="delete-warning">{warn}</p>}
        <div>
          <label htmlFor="del-reason" className="label">Why? <span className="font-normal text-muted">(optional, kept in the audit log)</span></label>
          <input id="del-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="field" placeholder="e.g. Duplicate, created by mistake, test bid" />
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="danger">Delete bid</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Calls the delete / restore API. Returns null when it worked, else a plain-language error. */
export async function postDelete(estimateId: string, action: "delete" | "restore", reason?: string): Promise<string | null> {
  const r = await fetch("/api/pipeline/delete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ estimateId, action, reason }),
  }).catch(() => null);
  if (r?.ok) return null;
  const d = await r?.json().catch(() => null);
  return (d?.error?.message as string | undefined) ?? `Couldn't ${action} that bid. Check your connection and try again.`;
}
