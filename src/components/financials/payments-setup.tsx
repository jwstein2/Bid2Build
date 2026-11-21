"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AccountState } from "@/lib/financials/connect";

type Settings = { cardEnabled: boolean; achEnabled: boolean; cardFeePayer: "contractor" | "customer" };

async function post(payload: Record<string, unknown>) {
  const res = await fetch("/api/financials/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Something went wrong. Nothing was changed.");
  return body;
}

/** Connect / finish the contractor's Stripe account, and the card / bank / card-fee settings. */
export function PaymentsSetup({ canManage, state, hasAccount, settings, surchargeAllowed }:
  { canManage: boolean; state: AccountState; hasAccount: boolean; settings: Settings | null; surchargeAllowed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Settings | null>(settings);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  const onboard = () => run("onboard", async () => { const { url } = await post({ action: "onboard" }); window.location.assign(url); });
  const refresh = () => run("refresh", async () => { await post({ action: "refresh" }); router.refresh(); });
  const save = (patch: Partial<Settings>) => run("settings", async () => { const next = await post({ action: "settings", ...patch }); setS(next as Settings); });

  if (!canManage) {
    return <p className="text-sm text-ink-soft">{state === "ready" ? "Customers can pay your invoices online." : "Ask your company owner to connect a Stripe account so customers can pay online."}</p>;
  }
  return (
    <div className="space-y-4">
      {state === "not_started" && <p className="text-sm text-ink-soft">Connect takes about 10 minutes on Stripe&apos;s secure site. Have your business details, EIN or SSN, and the bank account for deposits ready. If you already use Stripe, you can sign in to it.</p>}
      {state !== "ready" && state !== "not_started" && <p className="text-sm text-ink-soft">Stripe needs a bit more before customers can pay you online. Continue setup to see what&apos;s missing.</p>}
      <div className="flex flex-wrap gap-2">
        {state !== "ready" && <Button onClick={onboard} disabled={busy !== null} data-testid="connect-stripe">{busy === "onboard" ? "Opening Stripe…" : hasAccount ? "Continue Stripe setup" : "Connect Stripe"}</Button>}
        {hasAccount && <Button variant="secondary" onClick={refresh} disabled={busy !== null}>{busy === "refresh" ? "Checking…" : "Check status"}</Button>}
        {hasAccount && <a className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline" href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">Open your Stripe Dashboard</a>}
      </div>
      {s && (
        <fieldset className="space-y-2 rounded-lg border border-line p-3" disabled={busy !== null}>
          <legend className="px-1 text-sm font-semibold">How customers can pay</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.cardEnabled} onChange={(e) => save({ cardEnabled: e.target.checked })} /> Card (credit and debit)</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.achEnabled} onChange={(e) => save({ achEnabled: e.target.checked })} /> Bank account (ACH): lowest fee, 3 to 5 business days to clear</label>
          <div className="pt-1 text-sm">
            <p className="font-semibold">Who pays the card fee</p>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" name="fee" checked={s.cardFeePayer === "contractor"} onChange={() => save({ cardFeePayer: "contractor" })} /> I do (most common)</label>
            <label className={`flex min-h-11 items-center gap-2 ${surchargeAllowed ? "" : "text-muted"}`}>
              <input type="radio" name="fee" checked={s.cardFeePayer === "customer"} disabled={!surchargeAllowed} onChange={() => save({ cardFeePayer: "customer" })} />
              My customer, as a disclosed card surcharge {surchargeAllowed ? "" : "(coming soon, after legal review of state surcharge rules)"}
            </label>
          </div>
        </fieldset>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** "Pay online link" on an issued invoice: creates (or replaces) the customer's secure payment link and copies it. */
export function PayLinkButton({ invoiceId }: { invoiceId: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function make() {
    setBusy(true); setMsg(null);
    try {
      const { url: u } = await post({ action: "link", invoiceId });
      setUrl(u);
      try { await navigator.clipboard.writeText(u); setMsg("Link copied. Paste it into your email or text to the customer."); } catch { setMsg("Copy the link below and send it to your customer."); }
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="text-sm font-semibold text-accent-ink underline disabled:opacity-60" onClick={make} disabled={busy} data-testid={`pay-link-${invoiceId}`}>
        {busy ? "Making link…" : url ? "New pay online link" : "Pay online link"}
      </button>
      {url && <input readOnly className="field text-xs" value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Payment link" />}
      {msg && <span className="text-xs text-ink-soft" role="status">{msg}</span>}
    </span>
  );
}
