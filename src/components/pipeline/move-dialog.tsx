"use client";
import { useState } from "react";
import { Modal } from "@/components/builder/dialogs";
import { Button } from "@/components/ui/button";
import { COLUMN_LABELS, type BoardBid, type Column } from "@/lib/pipeline/board";
import { todayLocal } from "./format";

export type MoveExtras = { note?: string; date?: string };

const COPY: Record<"won" | "lost" | "reopen" | "job", (b: BoardBid, to: Column) => { title: string; body: string; cta: string }> = {
  won: (b) => b.signing?.signed
    ? { title: "Mark as Approved / Won", body: "This bid has a verified e-signature, which stays on record.", cta: "Mark won" }
    : { title: "Mark as Approved Manually", body: "Use this when the customer approved outside Built2Bid (in person, by phone or email). It's recorded as a manual approval, not an e-signature.", cta: "Mark approved" },
  lost: () => ({ title: "Mark as Lost / Declined", body: "The bid stays in your records and history. Any e-signature evidence is kept.", cta: "Mark lost" }),
  reopen: (_b, to) => ({ title: `Move back to ${COLUMN_LABELS[to]}?`, body: "This bid is currently won. Moving it back removes its won date from your sales numbers. The change is recorded in the bid's history.", cta: `Move to ${COLUMN_LABELS[to]}` }),
  job: (_b, to) => ({ title: `Reopen as ${COLUMN_LABELS[to]}?`, body: "This bid was marked lost. Reopening it counts it as won again.", cta: "Reopen" }),
};

/** Confirmation for transitions that change sales numbers (won, lost, reopening). */
export function MoveDialog({ bid, to, kind, onCancel, onConfirm }: { bid: BoardBid; to: Column; kind: "won" | "lost" | "reopen" | "job"; onCancel: () => void; onConfirm: (x: MoveExtras) => void }) {
  const c = COPY[kind](bid, to);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayLocal());
  const askDate = kind === "won" && !bid.signing?.signed;
  return (
    <Modal open onOpenChange={(o) => { if (!o) onCancel(); }} title={c.title} description={`${bid.title}${bid.customer ? ` · ${bid.customer}` : ""}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onConfirm({ note: note.trim() || undefined, date: askDate ? date : undefined }); }} data-testid="move-dialog">
        <p className="text-sm text-ink-soft">{c.body}</p>
        {askDate && (
          <div>
            <label htmlFor="mv-date" className="label">Approval date</label>
            <input id="mv-date" type="date" required max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} className="field" />
          </div>
        )}
        <div>
          <label htmlFor="mv-note" className="label">{kind === "lost" ? "Why was it lost?" : "Note"} <span className="font-normal text-muted">(optional)</span></label>
          <input id="mv-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="field"
            placeholder={kind === "lost" ? "e.g. Price, timing, went with another contractor" : kind === "won" ? "e.g. Approved by phone, deposit received" : ""} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant={kind === "lost" ? "danger" : "primary"}>{c.cta}</Button>
        </div>
      </form>
    </Modal>
  );
}
