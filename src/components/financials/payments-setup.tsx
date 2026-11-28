"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AccountState } from "@/lib/financials/connect";

type Settings = {
  cardEnabled: boolean; achEnabled: boolean; cardFeePayer: "contractor" | "customer";
  surchargePct: number; cardCostPct: number; cardCostFixedCents: number; surchargeNoticeDate: string; surchargeAttested: boolean; noticeReadyOn?: string | null;
};
type SurchargeState = { code: string | null; ok: boolean; maxPct: number; reasons: string[]; notes: string[] };

async function post(payload: Record<string, unknown>) {
  const res = await fetch("/api/financials/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Something went wrong. Nothing was changed.");
  return body;
}

/** Connect / finish the contractor's Stripe account, and the card / bank / card-fee settings. */
export function PaymentsSetup({ canManage, state, hasAccount, settings, surchargeAllowed, surchargeState }:
  { canManage: boolean; state: AccountState; hasAccount: boolean; settings: Settings | null; surchargeAllowed: boolean; surchargeState?: SurchargeState }) {
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
  const save = (patch: Record<string, unknown>) => run("settings", async () => {
    const next = await post({ action: "settings", ...patch });
    setS((prev) => ({ ...(prev as Settings), ...(next as Partial<Settings>), surchargeNoticeDate: (next as { surchargeNoticeDate?: string | null }).surchargeNoticeDate ?? "",
      surchargePct: Number((next as { surchargePct?: unknown }).surchargePct ?? prev?.surchargePct ?? 0), cardCostPct: Number((next as { cardCostPct?: unknown }).cardCostPct ?? prev?.cardCostPct ?? 2.9) }));
    router.refresh();
  });
  const [draft, setDraft] = useState({ pct: String(settings?.surchargePct || 3), costPct: String(settings?.cardCostPct ?? 2.9), costFixed: String(settings?.cardCostFixedCents ?? 30), notice: settings?.surchargeNoticeDate ?? "", attest: Boolean(settings?.surchargeAttested) });
  const stateOk = Boolean(surchargeState?.ok);

  if (!canManage) {
    return <p className="text-sm text-ink-soft">{state === "ready" ? "Customers can pay your invoices online." : "Ask your company owner to connect a Stripe account so customers can pay online."}</p>;
  }
  return (
    <div className="space-y-4">
      {state === "not_started" && <p className="text-sm text-ink-soft">Connect takes about 10 minutes on Stripe&apos;s secure site. Have your business details, EIN or SSN, and the bank account for deposits ready. If you already use Stripe, you can sign in to it.</p>}
      {state === "not_started" && <p className="text-sm text-ink-soft" data-testid="connect-name-note">Your Stripe account is set up under this company profile&apos;s name, so customers see your business, not Built2Bid, on the pay page and their card statement. If Stripe offers to reuse details from another Stripe account, check that the business name it copies belongs to this company.</p>}
      {state !== "ready" && state !== "not_started" && <p className="text-sm text-ink-soft">Stripe needs a bit more before customers can pay you online. Continue setup to see what&apos;s missing.</p>}
      <div className="flex flex-wrap gap-2">
        {state !== "ready" && <Button loading={busy === "onboard"} onClick={onboard} disabled={busy !== null} data-testid="connect-stripe">{busy === "onboard" ? "Opening Stripe…" : hasAccount ? "Continue Stripe setup" : "Connect Stripe"}</Button>}
        {hasAccount && <Button loading={busy === "refresh"} variant="secondary" onClick={refresh} disabled={busy !== null}>{busy === "refresh" ? "Checking…" : "Check status"}</Button>}
        {hasAccount && <a className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline" href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">Open your Stripe Dashboard</a>}
      </div>
      {hasAccount && <p className="text-xs text-muted" data-testid="connect-rename-note">Customers see the business name and card statement name saved in Stripe. If you rename this company in Built2Bid, Stripe keeps the old name: update it in your Stripe Dashboard under Settings → Business → Public details.</p>}
      {s && (
        <fieldset className="space-y-2 rounded-lg border border-line p-3" disabled={busy !== null}>
          <legend className="px-1 text-sm font-semibold">How customers can pay</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.cardEnabled} onChange={(e) => save({ cardEnabled: e.target.checked })} /> Card (credit and debit)</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.achEnabled} onChange={(e) => save({ achEnabled: e.target.checked })} /> Bank account (ACH): lowest fee, 3 to 5 business days to clear</label>
          <div className="pt-1 text-sm">
            <p className="font-semibold">Who pays the card fee</p>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" name="fee" checked={s.cardFeePayer === "contractor"} onChange={() => save({ cardFeePayer: "contractor" })} /> I do (most common)</label>
            <label className={`flex min-h-11 items-center gap-2 ${surchargeAllowed && stateOk ? "" : "text-muted"}`}>
              <input type="radio" name="fee" checked={s.cardFeePayer === "customer"} disabled={!surchargeAllowed || !stateOk} onChange={() => save({ cardFeePayer: "customer" })} />
              My customer, as a disclosed credit card surcharge
            </label>
            {!surchargeAllowed && <p className="text-xs text-muted">Card surcharges are paused right now.</p>}
            {surchargeAllowed && !stateOk && <p className="text-xs text-muted">{surchargeState?.reasons[0] ?? "Card surcharges aren't available for your state."} Bank (ACH) payments are the low-cost option.</p>}
            {surchargeAllowed && stateOk && (
              <details className="mt-2 rounded-lg border border-line p-3" open={s.cardFeePayer === "customer" || undefined} data-testid="surcharge-setup">
                <summary className="cursor-pointer font-semibold">Surcharge setup and rules</summary>
                <div className="mt-2 space-y-3">
                  <ul className="list-disc space-y-1 pl-5 text-xs text-ink-soft">
                    <li>Credit cards only. Debit and prepaid cards are never surcharged: Built2Bid checks the card and removes the surcharge automatically.</li>
                    <li>At most {surchargeState?.maxPct}% from your state ({surchargeState?.code}), and never more than your actual card cost. We work out the cost limit for you.</li>
                    <li>Checked against your customer&apos;s state on every payment. Customers in states that ban surcharges (for example Connecticut, Massachusetts and Maine) are never charged one.</li>
                    <li>Shown to the customer before they pay, on the invoice (with the card total), and as its own line on Stripe&apos;s checkout. Bank (ACH) must stay on so customers can always pay with no surcharge.</li>
                    {surchargeState?.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="text-xs">Surcharge rate (%)<input className="field mt-1" inputMode="decimal" value={draft.pct} onChange={(e) => setDraft({ ...draft, pct: e.target.value })} /></label>
                    <label className="text-xs">Your card rate (%)<input className="field mt-1" inputMode="decimal" value={draft.costPct} onChange={(e) => setDraft({ ...draft, costPct: e.target.value })} /></label>
                    <label className="text-xs">Your per-payment fee (cents)<input className="field mt-1" inputMode="numeric" value={draft.costFixed} onChange={(e) => setDraft({ ...draft, costFixed: e.target.value })} /></label>
                  </div>
                  <label className="block text-xs">Date you told Stripe you will surcharge (Visa and Mastercard require 30 days&apos; notice to your processor; email Stripe support or use the support form in your Stripe Dashboard)
                    <input type="date" className="field mt-1 w-auto" value={draft.notice} onChange={(e) => setDraft({ ...draft, notice: e.target.value })} />
                  </label>
                  {s.noticeReadyOn && <p className="text-xs text-muted">Surcharging can start on {s.noticeReadyOn}.</p>}
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={draft.attest} onChange={(e) => setDraft({ ...draft, attest: e.target.checked })} />
                    <span>I confirm the rate doesn&apos;t exceed what I pay to accept credit cards, I gave Stripe notice on the date above, I&apos;ll surcharge Visa, Mastercard, Discover and American Express credit cards the same way, and I&apos;m responsible for following card network rules and the law where I and my customers are.</span>
                  </label>
                  <Button loading={busy === "settings"} variant="secondary" disabled={busy !== null} data-testid="save-surcharge" onClick={() => save({
                    surchargePct: Math.round(Number(draft.pct) * 100) / 100, cardCostPct: Math.round(Number(draft.costPct) * 100) / 100,
                    cardCostFixedCents: Math.round(Number(draft.costFixed)), surchargeNoticeDate: draft.notice, surchargeAttest: draft.attest,
                  })}>{busy === "settings" ? "Saving…" : "Save surcharge setup"}</Button>
                </div>
              </details>
            )}
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
