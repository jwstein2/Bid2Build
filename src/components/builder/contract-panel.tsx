"use client";
import { FilePlus2, History } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { Button } from "../ui/button";
import { Modal } from "./dialogs";
import { ContractSummaryCard, DocumentsPanel } from "../operations/documents-panel";
import { useBuilderOps } from "./ops-context";

/**
 * Near the proposal controls: for approved or signed bids, the contract value, which version was
 * approved, a clear "Create Change Order" action and the full document history.
 */
export function ContractPanel({ estimateId }: { estimateId: string }) {
  const { ops, refresh } = useBuilderOps();
  const [open, setOpen] = useState<null | "history" | "new">(null);
  const c = ops?.contract;
  if (!c || (!c.accepted && !c.approval)) {
    if (!ops) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-muted">Every version you send is kept in the document history.</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen("history")}><History className="h-4 w-4" aria-hidden /> Document history</Button>
        <Modal open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title="Document history" wide><DocumentsPanel estimateId={estimateId} onChanged={refresh} /></Modal>
      </div>
    );
  }
  return (
    <section className="mb-4 rounded-xl border border-ok/50 bg-surface p-4" aria-label="Approved contract" data-testid="contract-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">Approved contract</h2>
          <p className="text-sm text-muted">
            {c.approval ? <>Approved version <strong className="text-ink">v{c.approval.versionNumber ?? "?"}</strong> ({c.approval.source === "signature" ? "signed by the customer" : "marked won"}, {formatCurrency(Number(c.approval.total).toFixed(2))}). </> : null}
            Changes to the contract go through change orders: the approved proposal is never edited.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.canCreate && c.accepted && <Button size="sm" onClick={() => setOpen("new")} data-testid="create-change-order"><FilePlus2 className="h-4 w-4" aria-hidden /> Create Change Order</Button>}
          <Button size="sm" variant="secondary" onClick={() => setOpen("history")}><History className="h-4 w-4" aria-hidden /> Document history{c.changeOrderCount ? ` (${c.changeOrderCount} CO)` : ""}</Button>
        </div>
      </div>
      {c.summary && <div className="mt-3"><ContractSummaryCard s={c.summary} compact /></div>}
      <Modal open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title={open === "new" ? "Create change order" : "Document history"} wide>
        <DocumentsPanel estimateId={estimateId} startNew={open === "new" ? true : undefined} onChanged={refresh} />
      </Modal>
    </section>
  );
}
