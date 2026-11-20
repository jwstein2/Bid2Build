import Link from "next/link";
import { loadStaffSelf } from "@/lib/staff/server";
import { FEE_REASON, HOLD_REASON, PAYOUT_STATUS, feeCents, money } from "@/lib/payouts/labels";
import type { PayoutRow } from "@/components/payouts/ledger";
import { cn } from "@/lib/cn";
import { connectBank } from "./actions";

export const metadata = { title: "Payouts" };

interface MyPayouts {
  payouts: PayoutRow[]; ytd: { year: number; gross_cents: number; fees_cents: number; net_cents: number }; blockers: string[] | null;
  destination: { institution_name: string | null; last4: string | null; account_type: string; status: string; eligible_from: string | null; mode: string; verified_at: string | null } | null;
  classification: string; payment_method: string;
}

const MSG: Record<string, string> = {
  bank: "Bank account connected.", bank_changed: "Bank account changed. We emailed you a confirmation, and payouts go to the new account after the safety hold.",
  expired: "That bank connection session expired. Please start again.", no_method: "No bank account was added on the provider's page. Please try again.",
  save: "We couldn't save that bank account. Please try again.", provider: "The payment provider isn't reachable right now. Please try again later.",
  provider_not_configured: "Bank connections aren't switched on yet. The owner is setting this up.", payroll: "You're paid through payroll, so there's no payout bank to connect here.",
  not_staff: "That needs an active staff profile.", mode_mismatch: "Payouts are being reconfigured. Please try again later.", live_not_allowed: "Payouts are being reconfigured. Please try again later.",
};
const primary = "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-5 font-semibold text-white active:scale-[0.98]";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const Card = ({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) => <section id={id} className="scroll-mt-20 rounded-2xl border border-line bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">{title}</h2><div className="mt-3">{children}</div></section>;

/** Rep / contractor Payout Settings: connect bank (provider-hosted), status, YTD totals, history with gross/fee/net, statements. */
export default async function MyPayoutsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { me, db } = await loadStaffSelf("/staff/payouts");
  if (!me) return <p className="text-ink-soft">No staff profile for this sign-in. <Link className="underline" href="/staff">Back</Link></p>;
  const { data } = await db.rpc("staff_my_payouts");
  const p = data as MyPayouts | null;
  const contractor = me.classification === "contractor_1099" || me.classification === "vendor";
  const f = me.fee_policy;
  const test = me.payout_mode !== "live";
  const blockers = (p?.blockers ?? []).filter((b) => b !== "zero_amount");
  const d = p?.destination ?? null;
  const held = d?.eligible_from && new Date(d.eligible_from) > new Date();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Payouts</h1>
        <p className="mt-1 text-ink-soft">{contractor ? "Where your approved commissions are deposited, and what each payout included." : "How you're paid."}</p>
      </div>
      {test && contractor && <p className="rounded-lg border border-line bg-paper px-4 py-3 text-sm"><strong>Practice mode.</strong> Automated payouts aren&apos;t live yet. Anything shown as a test payout moved no money; your approved commissions are paid by the owner as before.</p>}
      {sp.ok && MSG[sp.ok] && <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success">{MSG[sp.ok]}</p>}
      {sp.err && <p role="alert" className="rounded-lg bg-warn-tint px-4 py-3 text-sm">{MSG[sp.err] ?? MSG.provider}</p>}

      {!contractor ? (
        <Card title="Paid through payroll">
          <p className="text-sm">{me.classification === "employee_w2" ? "As an employee, your wages are paid through payroll with taxes withheld. Direct deposit is set up with the payroll provider. Payroll Integration Required: until it's connected, the owner pays wages through an established payroll service, never from this page." : "Your classification is still being reviewed by the owner. Payout setup opens once that's done."}</p>
        </Card>
      ) : (<>
        <Card title="Payout Settings" id="connect">
          {d ? (
            <div className="space-y-2 text-sm">
              <p className="text-base font-semibold">{d.institution_name ?? "Bank account"} ••{d.last4 ?? "????"} <span className="text-sm font-normal text-ink-soft">({d.account_type})</span></p>
              <p className={cn(d.status === "verified" && !held ? "text-success" : "text-ink-soft")}>{d.status === "verified" ? (held ? `New account: safety hold until ${new Date(d.eligible_from!).toLocaleString()}` : "Verified and ready") : d.status === "failed" ? "The bank rejected a payout to this account. Please connect a different account." : "Waiting for verification"}</p>
            </div>
          ) : me.payment_method === "check" ? <p className="text-sm">You chose to be paid by check. The owner pays checks by hand.</p>
            : <p className="text-sm">Connect the account where you want your payouts. You&apos;ll enter it on our payment provider&apos;s secure page; Built2Bid never sees your full account or routing number, or your bank password.</p>}
          <form action={connectBank} className="mt-4"><button className={primary}>{d ? "Change bank account" : "Connect Bank Account"}</button></form>
          <p className="mt-2 text-xs text-ink-soft">Changing your bank account emails you and the owner, and starts a short safety hold before payouts go to the new account.</p>
        </Card>

        {blockers.length > 0 && (
          <Card title="Before you can be paid automatically">
            <ul className="space-y-1 text-sm">{blockers.map((b) => <li key={b}>• {HOLD_REASON[b] ?? b}{b === "w9_missing" || b === "agreements_missing" ? <> · <Link className="underline" href="/staff/onboarding">finish onboarding</Link></> : null}</li>)}</ul>
          </Card>
        )}

        <Card title={`${p?.ytd.year ?? new Date().getFullYear()} so far (paid)`}>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xs text-ink-soft">Earned</p><p className="text-lg font-bold">{money(p?.ytd.gross_cents ?? 0)}</p></div>
            <div><p className="text-xs text-ink-soft">Processing fees</p><p className="text-lg font-bold">{money(p?.ytd.fees_cents ?? 0)}</p></div>
            <div><p className="text-xs text-ink-soft">Deposited</p><p className="text-lg font-bold">{money(p?.ytd.net_cents ?? 0)}</p></div>
          </div>
          <p className="mt-3 text-xs text-ink-soft">Your 1099-NEC reports what you earned (gross), not the amount after processing fees. Keep fee records for your own taxes.</p>
        </Card>

        <Card title="Payout history">
          {!p || p.payouts.length === 0 ? <p className="text-sm text-ink-soft">No payouts yet. After the owner approves a commission statement, it&apos;s paid on the next payout run.</p> : (
            <ul className="divide-y divide-line">
              {p.payouts.map((x) => (
                <li key={x.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{x.ref}{x.mode === "test" && <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-[11px] font-bold text-ink-soft">TEST · no money moved</span>}</span>
                    <span className={cn("text-xs font-bold", x.status === "paid" ? "text-success" : x.status === "failed" || x.status === "returned" ? "text-danger" : "text-ink-soft")}>{PAYOUT_STATUS[x.status] ?? x.status}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                    <span>Earned {money(x.gross_cents)}</span>
                    <span>Fee {x.fee_bearer === "recipient" ? `-${money(x.fee_cents)}` : "paid by Built2Bid"}</span>
                    <span className="text-right font-bold">Net {money(x.net_cents)}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{x.items.filter((i) => i.active).map((i) => i.description).join(", ") || "—"} · {x.status === "paid" ? `paid ${day(x.settled_at)}` : `scheduled ${day(x.scheduled_for)}`}{x.destination ? ` · ${x.destination.institution_name ?? "Bank"} ••${x.destination.last4 ?? "?"}` : ""}</p>
                  {x.fee_bearer === "company" && x.fee_reason && x.fee_cents > 0 && <p className="text-xs text-ink-soft">Why Built2Bid paid the fee: {FEE_REASON[x.fee_reason] ?? x.fee_reason}</p>}
                  {x.hold_reasons.length > 0 && x.status === "held" && <p className="text-xs text-warn">On hold: {x.hold_reasons.map((h) => HOLD_REASON[h] ?? h).join(", ")}</p>}
                  {x.failure_message && (x.status === "failed" || x.status === "returned") && <p className="text-xs text-danger">{x.failure_message}</p>}
                  <a className="mt-1 inline-block text-xs underline" href={`/staff/payouts/statement/${encodeURIComponent(x.ref)}`}>Download statement (CSV)</a>
                </li>
              ))}
            </ul>
          )}
          {me.sales_rep && <p className="mt-3 text-xs text-ink-soft">Commission details for each month are in <Link className="underline" href="/sales/commissions">Sales Hub → Commissions</Link>.</p>}
        </Card>

        {f && (
          <Card title="Processing fees">
            <p className="text-sm">{f.approved ? "When you're paid by ACH, the provider's transfer fee is deducted from that payout, as you agreed in the fee disclosure, unless the law where you work doesn't allow it." : "Built2Bid currently pays all transfer fees."}</p>
            <ul className="mt-2 space-y-1 text-sm">
              <li>Standard ACH (1-3 business days): {money(f.standard_fixed_cents)}{f.standard_bps ? ` + ${(f.standard_bps / 100).toFixed(2)}%` : ""} per payout. Example: {money(50000)} earned → {money(50000 - feeCents(50000, "standard", f))} deposited.</li>
              <li>{f.instant_enabled ? `Instant (optional): ${money(f.instant_fixed_cents)} + ${(f.instant_bps / 100).toFixed(2)}% (min ${money(f.instant_min_cents)}).` : "Instant payouts aren't offered right now."}</li>
              <li>No fee to create your account, no monthly fee. Approved amounts are batched into one payout per pay run, so you pay one fee instead of several.</li>
            </ul>
          </Card>
        )}
      </>)}
    </div>
  );
}
