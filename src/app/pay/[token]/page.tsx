import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CheckCircle2, Clock, Lock, XCircle } from "lucide-react";
import { site } from "@/lib/site";
import { feeNote, looksLikePayToken } from "@/lib/financials/connect";
import { loadPayPage, payOffer } from "@/lib/financials/connect-server";
import { normalizeState, STATE_CODES, stateName } from "@/lib/financials/surcharge";
import { connectMode } from "@/lib/financials/connect";
import { PayButton } from "./pay-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pay your invoice", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

const usd = (v: string) => Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

/**
 * A customer's secure page for paying one invoice. No account: the link from the contractor is the key. Payment
 * happens on Stripe's hosted page and goes straight to the contractor's own Stripe account.
 */
export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string; canceled?: string; st?: string }> }) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const bad = <Shell><State icon={<XCircle className="h-8 w-8 text-danger" aria-hidden />} title="This link isn't valid">Check that you opened the full link from your contractor. If it still doesn&apos;t work, ask them for a new one.</State></Shell>;
  if (!looksLikePayToken(token)) return bad;
  const p = await loadPayPage(token).catch(() => null);
  if (!p) return bad;
  const shell = (body: ReactNode) => <Shell company={p.businessName}>{body}</Shell>;
  if (sp.paid) {
    return shell(<State icon={<CheckCircle2 className="h-8 w-8 text-ok" aria-hidden />} title="Thank you, your payment was sent">
      {p.businessName} will see it shortly. Card payments show right away. Bank (ACH) payments take 3 to 5 business days to clear. Stripe emails you a receipt. If you paid with a debit or prepaid card, no surcharge was charged.
    </State>);
  }
  if (p.status === "void") return shell(<State icon={<Clock className="h-8 w-8 text-warn" aria-hidden />} title="This invoice was canceled">Please contact {p.businessName} if you have questions.</State>);
  if (Number(p.balance) <= 0) return shell(<State icon={<CheckCircle2 className="h-8 w-8 text-ok" aria-hidden />} title="This invoice is paid">Nothing is due on invoice {p.number}. Thank you.</State>);
  const ready = connectMode() !== "off" && Boolean(p.account?.charges_enabled);
  const chosenState = p.customerState ?? normalizeState(sp.st ?? null);
  const offer = payOffer(p, chosenState);
  const a = p.account;
  const cents = Math.round(Number(p.balance) * 100);
  const withFee = offer.surcharge ? usd(((cents + offer.surcharge.cents) / 100).toFixed(2)) : null;
  const surchargeFlow = Boolean(a && (offer.surcharge || offer.needsState));
  return shell(
    <>
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-extrabold text-navy">Invoice {p.number}</h1>
        <p className="text-ink-soft">From {p.businessName}{p.billToName ? ` to ${p.billToName}` : ""}</p>
      </div>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm" aria-label="Invoice summary">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Issued</dt><dd className="font-semibold">{day(p.issueDate)}</dd></div>
          <div><dt className="text-muted">Due</dt><dd className="font-semibold">{day(p.dueDate)}</dd></div>
          <div><dt className="text-muted">Invoice total</dt><dd className="tabular font-semibold">{usd(p.total)}</dd></div>
          <div><dt className="text-muted">Amount due</dt><dd className="tabular text-lg font-extrabold text-navy">{usd(p.balance)}</dd></div>
        </dl>
        {sp.canceled && <p className="mt-4 rounded-lg bg-warn/10 p-3 text-sm">Payment wasn&apos;t completed. You can try again below.</p>}
        {p.pending && <p className="mt-4 rounded-lg bg-brand-tint p-3 text-sm">A bank payment for this invoice is already on its way. You don&apos;t need to pay again unless {p.businessName} asks you to.</p>}
        <div className="mt-5">
          {ready && a && surchargeFlow ? (
            <div className="space-y-4">
              {offer.needsState && a.card_enabled && (
                <form method="get" className="space-y-2 rounded-lg border border-line p-3" aria-label="Your state">
                  <label htmlFor="pay-st" className="block text-sm font-semibold">Paying by card? Choose your state first</label>
                  <p className="text-xs text-muted">Card surcharge rules differ by state, so we check yours before showing the card total.</p>
                  <div className="flex flex-wrap gap-2">
                    <select id="pay-st" name="st" className="field min-h-11 w-auto" defaultValue="" required>
                      <option value="" disabled>Select your state</option>
                      {STATE_CODES.map((c) => <option key={c} value={c}>{stateName(c)}</option>)}
                    </select>
                    <button type="submit" className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold">Show card total</button>
                  </div>
                </form>
              )}
              {offer.surcharge && a.card_enabled && (
                <div className="space-y-2 rounded-lg border border-line p-3" data-testid="surcharge-offer">
                  <PayButton token={token} amount={withFee ?? usd(p.balance)} method="card" state={chosenState} testId="pay-card"
                    label={`Pay by credit card: ${withFee}`} />
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm tabular">
                    <dt className="text-muted">Amount due</dt><dd>{usd(p.balance)}</dd>
                    <dt className="text-muted">Credit card surcharge ({Number(offer.surcharge.pct.toFixed(2))}%)</dt><dd>{usd((offer.surcharge.cents / 100).toFixed(2))}</dd>
                    <dt className="font-semibold">Total by credit card</dt><dd className="font-semibold">{withFee}</dd>
                  </dl>
                  <p className="text-xs text-ink-soft" data-testid="surcharge-disclosure">{offer.surcharge.disclosure} Debit and prepaid cards are charged {usd(p.balance)} only; the surcharge is removed automatically.</p>
                </div>
              )}
              {a.ach_enabled && (
                <div>
                  <PayButton token={token} amount={usd(p.balance)} method="ach" variant={offer.surcharge ? "secondary" : "primary"} testId="pay-ach"
                    label={`Pay by bank (ACH), no surcharge: ${usd(p.balance)}`} />
                  <p className="mt-1 text-xs text-muted">Bank payments take 3 to 5 business days to clear.</p>
                </div>
              )}
            </div>
          ) : ready && a
            ? <><PayButton token={token} amount={usd(p.balance)} /><p className="mt-2 text-xs text-muted">{feeNote(a.card_enabled, a.ach_enabled)}</p></>
            : <p className="text-sm text-ink-soft">Online payment isn&apos;t available for this invoice right now. Please pay {p.businessName} directly and include invoice number {p.number}.</p>}
        </div>
      </section>
      <p className="flex items-center gap-2 text-xs text-muted"><Lock className="h-3.5 w-3.5" aria-hidden />Payments are processed by Stripe and go directly to {p.businessName}. {site.name} never sees your card or bank details.</p>
    </>,
  );
}

function Shell({ company, children }: { company?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-3 px-4 py-3">
          <span className="truncate font-display font-extrabold text-navy">{company ?? "Invoice payment"}</span>
          <span className="shrink-0 text-xs text-muted">Secure payment page by {site.name}</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[760px] space-y-5 px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}

function State({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-sm sm:p-10">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-black/5">{icon}</div>
      <h1 className="font-display text-2xl font-extrabold text-navy">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-ink-soft">{children}</p>
    </div>
  );
}
