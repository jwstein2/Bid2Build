"use client";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Eye, FileJson } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Card } from "@/components/ui/misc";
import { formatCurrency } from "@/lib/estimate/money";
import { LocalTime } from "@/components/esign/local-time";
import { SignedPdfButton } from "@/components/esign/signed-pdf-button";

export interface SignedBid {
  id: string; estimateId: string; customer: string; project: string; total: number; signedAt: string; versionNumber: number;
  pdfStatus: "pending" | "ready" | "failed";
}

const OPEN_EVENT = "b2b:recently-signed-toggle";
/** In-memory fallback so the toggle still works when storage is blocked. */
const memory = new Map<string, boolean>();
function subscribeOpen(cb: () => void) {
  window.addEventListener(OPEN_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(OPEN_EVENT, cb); window.removeEventListener("storage", cb); };
}
function readOpen(key: string): boolean {
  try { const v = localStorage.getItem(key); if (v !== null) return v !== "0"; } catch { /* storage blocked */ }
  return memory.get(key) ?? true;
}

/**
 * Recently Signed: accepted proposals at the top of the dashboard, newest first, with the amount of
 * the exact signed version. A signature is an acceptance, not a payment, so nothing here says "paid".
 * The header toggles the list open or closed; it starts open and the choice is remembered per user
 * in this browser.
 */
export function RecentlySigned({ bids, days, max = 5, userId }: { bids: SignedBid[]; days: number; max?: number; userId?: string }) {
  const shown = bids.slice(0, max);
  const key = `b2b.recentlySigned.open${userId ? `.${userId}` : ""}`;
  const open = useSyncExternalStore(subscribeOpen, () => readOpen(key), () => true);
  const toggle = () => {
    try { localStorage.setItem(key, open ? "0" : "1"); } catch { /* storage blocked */ }
    memory.set(key, !open);
    window.dispatchEvent(new Event(OPEN_EVENT));
  };
  return (
    <Card className="border-ok/40" aria-labelledby="recently-signed-h" data-testid="recently-signed">
      <h2 className={`bg-ok-tint/60 ${open ? "border-b border-line" : ""}`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="recently-signed-list"
          data-testid="recently-signed-toggle"
          className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-ok-tint"
        >
          <span id="recently-signed-h" className="flex items-center gap-2 font-display text-lg font-extrabold text-navy">
            <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden /> Recently Signed
          </span>
          <span className="flex items-center gap-2 text-sm font-normal text-ink-soft">
            {bids.length} signed in the last {days} days
            <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            <span className="sr-only">{open ? "Hide list" : "Show list"}</span>
          </span>
        </button>
      </h2>
      <div id="recently-signed-list" hidden={!open}>
      <ul className="divide-y divide-line">
        {shown.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1 max-sm:basis-full">
              <p className="truncate font-semibold"><span className="sr-only">Project: </span>{b.project}</p>
              <p className="text-sm text-ink-soft"><span className="sr-only">Customer: </span>{b.customer}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint px-2.5 py-0.5 text-xs font-bold text-ok"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Signed</span>
              <span className="tabular font-bold text-navy"><span className="sr-only">Proposal amount: </span>{formatCurrency(String(b.total))}</span>
              <span className="text-sm text-muted"><span className="sr-only">Signed </span><LocalTime iso={b.signedAt} /></span>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Link href={`/signed/${b.id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-navy px-3 text-sm font-semibold text-white hover:bg-navy/90"><Eye className="h-4 w-4" aria-hidden />View Signed Proposal</Link>
              <SignedPdfButton signatureId={b.id} compact />
              <Link href={`/signed/${b.id}#sig-h`} aria-label={`Signature details for ${b.project}`} title="Signature details" className="grid h-10 w-10 place-items-center rounded-lg text-ink-soft hover:bg-black/5"><FileJson className="h-4 w-4" aria-hidden /></Link>
            </div>
            {b.pdfStatus !== "ready" && <p className="w-full text-xs text-warn">Signed. The signed PDF is {b.pdfStatus === "failed" ? "being retried" : "being prepared"}.</p>}
          </li>
        ))}
      </ul>
      {bids.length > shown.length && <p className="border-t border-line px-4 py-2 text-sm text-muted">Showing the {shown.length} most recent. Filter Your bids by &quot;Signed&quot; to see all.</p>}
      </div>
    </Card>
  );
}
