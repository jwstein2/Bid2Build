"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { claimOffer, reportOffer } from "@/lib/offers/client";
import { CANCEL_REASONS, type CancelReason } from "@/lib/offers/policy";

async function openPortal(intent: "cancel" | "annual"): Promise<string | null> {
  const r = await fetch("/api/stripe/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent }) }).catch(() => null);
  const d = await r?.json().catch(() => null);
  if (r?.ok && d?.url) { window.location.assign(d.url); return null; }
  return d?.error?.message ?? "Billing portal unavailable. Please try again.";
}

/** T5: monthly subscriber with 3+ paid months and 8+ finalized bids. Shows at most once per 90 days. */
export function AnnualNudge({ bids, savings, annualPrice }: { bids: number; savings: string; annualPrice: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void claimOffer("t5_annual").then((r) => setShow(r.show));
  }, []);
  if (!show) return null;
  const dismiss = () => { reportOffer("t5_annual", "dismissed"); setShow(false); };
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-accent/40 bg-brand-tint p-4 text-sm" data-testid="offer-t5">
      <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-ink" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">You&apos;ve finalized {bids} bids on Individual Unlimited. Switching to annual saves {savings} a year.</p>
        <p className="mt-0.5 text-ink-soft">Same features, {annualPrice} once a year. Stripe shows the exact amount and date before anything changes.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button loading={busy} size="sm" disabled={busy} onClick={async () => { setBusy(true); setErr(null); reportOffer("t5_annual", "clicked", "portal_annual"); const e = await openPortal("annual"); if (e) { setErr(e); setBusy(false); } }}>
            Switch to annual
          </Button>
          <button type="button" onClick={dismiss} className="min-h-9 text-ink-soft hover:text-ink">Not now</button>
        </div>
        {err && <p role="alert" className="mt-2 text-danger">{err}</p>}
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded text-muted hover:bg-black/5"><X className="h-4 w-4" aria-hidden /></button>
    </div>
  );
}

/**
 * RET-1 "Before you go": one optional question, an export link and (monthly) the annual option,
 * then Stripe's cancellation page. Never blocks cancelling: "Continue to cancel" works without an answer.
 */
export function CancelStep({ monthly, annualSavings }: { monthly: boolean; annualSavings: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [busy, setBusy] = useState<"cancel" | "annual" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) panelRef.current?.querySelector<HTMLElement>("input")?.focus(); }, [open]);

  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); void claimOffer("ret1_cancel"); }} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ink-soft underline underline-offset-2 hover:text-ink" data-testid="cancel-start">
        Cancel subscription
      </button>
    );
  }
  const go = async (intent: "cancel" | "annual") => {
    setBusy(intent); setErr(null);
    if (reason) reportOffer("ret1_cancel", "answered", reason);
    reportOffer("ret1_cancel", "clicked", intent === "cancel" ? "portal_cancel" : "portal_annual");
    const e = await openPortal(intent);
    if (e) { setErr(e); setBusy(null); }
  };
  return (
    <div ref={panelRef} className="mt-4 rounded-xl border border-line bg-paper p-4" data-testid="cancel-step" role="region" aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} className="font-bold">Before you go</h3>
      <fieldset className="mt-2">
        <legend className="text-sm text-ink-soft">What&apos;s the main reason? (optional, it helps us improve)</legend>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {CANCEL_REASONS.map((r) => (
            <label key={r.code} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-black/5">
              <input type="radio" name={`${id}-reason`} value={r.code} checked={reason === r.code} onChange={() => setReason(r.code)} />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <ul className="mt-3 space-y-1 text-sm text-ink-soft">
        <li>Your bids, customers and settings stay in your account, and your free credits apply again.</li>
        <li>Want a copy first? <Link href="/settings/account#export" onClick={() => reportOffer("ret1_cancel", "clicked", "export")} className="font-semibold text-accent-ink underline">Export all your data</Link>.</li>
        <li>Paid periods aren&apos;t refunded. You keep Individual Unlimited until the end of the period you paid for.</li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button loading={busy === "cancel"} variant="secondary" disabled={busy !== null} onClick={() => go("cancel")} data-testid="cancel-continue">
          Continue to cancel
        </Button>
        {monthly && (
          <Button loading={busy === "annual"} variant="ghost" disabled={busy !== null} onClick={() => go("annual")}>
            Switch to annual instead (save {annualSavings})
          </Button>
        )}
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 text-sm text-muted hover:text-ink">Keep my plan</button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}
