import Link from "next/link";
import { Panel, Chip, Empty, Mini, Table } from "@/components/admin/cc";
import { PROBLEM, usd } from "@/lib/reconciliation/facts";
import { bankAccounts, platformConnection } from "@/lib/quickbooks/platform";
import type { createAdminClient } from "@/lib/supabase/server";
import { acknowledgeException, reconcileNow, saveReconSettings } from "./recon-actions";

type Db = ReturnType<typeof createAdminClient>;
const btn = "cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]";
const ct = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) + " CT" : "never");
const SEV_TONE = { material: "red", action: "amber", info: "muted" } as const;
const RUN_TONE = { passed: "green", exceptions: "amber", failed: "red", running: "blue" } as const;

type Settings = { auto_approve_statements: boolean; auto_approve_limit_cents: number; auto_approve_from_day: number; qb_auto_bills: boolean; qb_record_provider_payouts: boolean;
  qb_payment_account_id: string | null; qb_payment_account_name: string | null; authorized_at: string | null };
type Run = { id: string; kind: string; status: keyof typeof RUN_TONE; started_at: string; finished_at: string | null; error: string | null; steps: Record<string, unknown> };
type Exc = { id: string; kind: string; severity: keyof typeof SEV_TONE; status: string; summary: string; amount_cents: number | null; first_seen_at: string; occurrences: number; ack_note: string | null; period_month: string | null };
type Overview = { month: string; settings: Settings; cards: Record<string, number>; last_run: Run | null; last_good_run: Run | null; qb: { status: string; environment: string; last_check_at: string | null } | null;
  periods: { period_month: string; status: string; closed_at: string | null; blocked_reasons: string[]; attempts: number }[]; exceptions: Exc[] };
type Trace = { program: string; id: string; customer: string | null; payee: string | null; attribution: string | null; invoice: string | null; invoice_status: string | null; invoice_paid_cents: number | null;
  invoice_paid_at: string | null; refunded_cents: number | null; dispute_status: string | null; kind: string; year_no: number; period: string; amount_cents: number; status: string;
  statement_status: string | null; payout_ref: string | null; payout_status: string | null; qb_bill: string | null; qb_status: string | null; problems: string[] };

/**
 * Admin → Payments & Payouts → Reconciliation: one place to see that every commission traces back to a verified customer
 * payment and forward to a payout or QuickBooks bill. Runs daily on its own; this page is for looking, not for routine work.
 */
export async function ReconciliationTab({ db, caller, owner, q }: { db: Db; caller: string; owner: boolean; q: { q?: string; program?: string; status?: string; from?: string; to?: string } }) {
  const { data, error } = await db.rpc("admin_recon_overview", { p_caller: caller });
  if (error || !data) return <Panel title="Not installed"><p className="text-sm text-ink-soft">Run migration 20270223001000_commission_reconciliation.sql first.</p></Panel>;
  const o = data as Overview;
  const { data: traceData } = await db.rpc("admin_recon_trace", { p_caller: caller, p: { q: q.q ?? "", program: q.program ?? "", status: q.status ?? "", from: q.from ?? "", to: q.to ?? "" } });
  const trace = (traceData as Trace[] | null) ?? [];
  const c = o.cards;
  const qbc = owner ? await platformConnection(db).catch(() => null) : null;
  const banks = qbc && qbc.status === "active" && qbc.environment === "production" ? await bankAccounts(db, qbc).catch(() => null) : null;
  const open = o.exceptions.filter((e) => e.status === "open");
  const lastClosed = o.periods.find((p) => p.status === "closed");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Mini label={`Verified customer revenue (${o.month})`} value={usd(c.verified_revenue_cents)} tone="green" />
        <Mini label="Accrued commissions (sales + affiliate)" value={usd(c.accrued_sales_cents + c.accrued_affiliate_cents)} tone="blue" />
        <Mini label="Failed customer payments" value={usd(c.awaiting_customer_payment_cents)} tone={c.awaiting_customer_payment_cents ? "amber" : "muted"} />
        <Mini label="Statements waiting for approval" value={usd(c.pending_approval_cents)} tone={c.pending_approval_cents ? "amber" : "muted"} />
        <Mini label="QuickBooks bills awaiting payment" value={usd(c.qb_awaiting_payment_cents)} tone="violet" />
        <Mini label="Payouts scheduled / processing" value={`${usd(c.payouts_scheduled_cents)} / ${usd(c.payouts_processing_cents)}`} tone="blue" />
        <Mini label="Paid this month" value={usd(c.paid_this_month_cents)} tone="green" />
        <Mini label="Reversed this month" value={usd(c.reversed_this_month_cents)} tone={c.reversed_this_month_cents ? "amber" : "muted"} />
      </div>

      <Panel title="Status" action={<div className="flex gap-2"><form action={reconcileNow}><button className={btn}>Reconcile now</button></form><a className={btn} href={`/api/admin/reconciliation/export?month=${o.month}`}>Export this month (CSV)</a></div>}>
        <ul className="space-y-1.5 text-sm text-ink-soft">
          <li>Last run: {o.last_run ? <><Chip tone={RUN_TONE[o.last_run.status] ?? "muted"}>{o.last_run.status}</Chip> {ct(o.last_run.started_at)} ({o.last_run.kind}){o.last_run.error ? <span className="text-[var(--cc-red)]"> {o.last_run.error}</span> : null}</> : "never (runs daily at 8:40 AM CT)"}</li>
          <li>Last successful reconciliation: {ct(o.last_good_run?.finished_at)}{o.last_good_run && o.last_good_run.steps?.stripe_ok === false ? <span className="text-[var(--cc-amber)]"> (Stripe not checked: {String((o.last_good_run.steps.stripe as { skipped?: string } | undefined)?.skipped ?? "error")})</span> : null}</li>
          <li>QuickBooks: {o.qb ? `${o.qb.status === "active" ? "connected" : "needs sign-in"} (${o.qb.environment}), last paid-bill check ${ct(o.qb.last_check_at)}` : "not connected"}</li>
          <li>Last completed monthly close: {lastClosed ? `${lastClosed.period_month.slice(0, 7)} on ${ct(lastClosed.closed_at)}` : "none yet"}</li>
          <li>Open exceptions: <span className={open.length ? "text-[var(--cc-amber)]" : "text-[var(--cc-green)]"}>{open.length}</span></li>
        </ul>
        <p className="mt-3 text-[11px] text-ink-soft">Every day: Stripe payments, refunds and chargebacks are checked against the commission ledgers, payouts and QuickBooks. Nothing is ever changed to make the numbers match. You get an email only when something needs you.</p>
      </Panel>

      <Panel title="Exceptions">
        {o.exceptions.length === 0 ? <Empty>Nothing needs attention.</Empty> : (
          <Table head={["", "What", "Amount", "Since", ""]} align={["l", "l", "r", "l", "l"]}>
            {o.exceptions.map((e) => (
              <tr key={e.id}>
                <td><Chip tone={SEV_TONE[e.severity]}>{e.severity === "material" ? "discrepancy" : e.severity === "action" ? "action" : "info"}</Chip>{e.status === "acknowledged" && <span className="ml-1 text-[11px] text-ink-soft">acknowledged</span>}</td>
                <td className="max-w-md text-xs text-white">{e.summary}{e.ack_note && <p className="mt-1 text-[11px] text-ink-soft">Note: {e.ack_note}</p>}</td>
                <td className="text-right text-xs text-white">{e.amount_cents != null ? usd(Math.abs(e.amount_cents)) : ""}</td>
                <td className="text-xs text-ink-soft">{ct(e.first_seen_at)}{e.occurrences > 1 ? ` · seen ${e.occurrences}×` : ""}</td>
                <td>{e.status === "open" && e.severity !== "info" && (
                  <form action={acknowledgeException} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={e.id} />
                    <input name="note" required minLength={5} placeholder="What you checked" className="field field-sm w-40" aria-label="Acknowledgment note" />
                    <button className={btn}>Acknowledge</button>
                  </form>)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-[11px] text-ink-soft">An exception clears on its own once the records are fixed. Acknowledging documents a reviewed difference in the monthly report and lets the month close; it never changes any amount.</p>
      </Panel>

      <Panel title="Monthly close">
        {o.periods.length === 0 ? <Empty>The first month closes automatically a few days after it ends.</Empty> : (
          <Table head={["Month", "Status", "Detail", "Report"]}>
            {o.periods.map((p) => (
              <tr key={p.period_month}>
                <td className="text-white">{p.period_month.slice(0, 7)}</td>
                <td><Chip tone={p.status === "closed" ? "green" : p.status === "blocked" ? "amber" : "muted"}>{p.status}</Chip></td>
                <td className="text-xs text-ink-soft">{p.status === "closed" ? `Closed ${ct(p.closed_at)}` : p.blocked_reasons.join(", ") || "waiting"}</td>
                <td><a className="text-xs underline" href={`/api/admin/reconciliation/export?month=${p.period_month.slice(0, 7)}`}>CSV</a></td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Trace a commission" action={
        <form className="flex flex-wrap gap-2">
          <input type="hidden" name="tab" value="reconciliation" />
          <input name="q" defaultValue={q.q ?? ""} placeholder="Customer, rep, affiliate, invoice, bill or payout" className="field field-sm w-64" aria-label="Search" />
          <select name="program" defaultValue={q.program ?? ""} className="field field-sm" aria-label="Program"><option value="">Sales + affiliates</option><option value="sales">Sales reps</option><option value="affiliate">Affiliates</option></select>
          <select name="status" defaultValue={q.status ?? ""} className="field field-sm" aria-label="Status"><option value="">Any status</option>{["pending", "earned", "approved", "payable", "paid", "held", "reversed", "canceled", "ineligible"].map((s) => <option key={s}>{s}</option>)}</select>
          <input type="date" name="from" defaultValue={q.from ?? ""} className="field field-sm" aria-label="From" />
          <input type="date" name="to" defaultValue={q.to ?? ""} className="field field-sm" aria-label="To" />
          <button className={btn}>Search</button>
        </form>}>
        {trace.length === 0 ? <Empty>No commissions match.</Empty> : (
          <Table head={["Customer → payee", "Stripe payment", "Commission", "Statement / payout", "QuickBooks", "Checks"]} minWidth={980}>
            {trace.map((t) => (
              <tr key={`${t.program}-${t.id}`}>
                <td className="text-xs"><span className="text-white">{t.customer ?? "(deleted account)"}</span><br /><span className="text-ink-soft">→ {t.payee} · {t.program === "sales" ? "Sales rep" : "Affiliate"}{t.attribution ? ` (${t.attribution})` : ""}</span></td>
                <td className="cc-mono text-[11px] text-ink-soft">{t.invoice ?? "—"}<br />{t.invoice_status ? `${t.invoice_status}${t.invoice_paid_cents ? ` ${usd(t.invoice_paid_cents)}` : ""}${t.invoice_paid_at ? ` · ${t.invoice_paid_at.slice(0, 10)}` : ""}${t.refunded_cents ? ` · refunded ${usd(t.refunded_cents)}` : ""}${t.dispute_status ? ` · dispute ${t.dispute_status}` : ""}` : "not verified yet"}</td>
                <td className="text-xs text-white">{usd(t.amount_cents)} <span className="text-ink-soft">{t.kind === "commission" ? `year ${t.year_no}` : t.kind} · {String(t.period).slice(0, 7)}</span><br /><Chip tone={t.status === "paid" ? "green" : ["reversed", "canceled", "ineligible"].includes(t.status) ? "muted" : t.status === "held" ? "amber" : "blue"}>{t.status}</Chip></td>
                <td className="text-xs text-ink-soft">{t.statement_status ? `statement ${t.statement_status}` : ""}{t.payout_ref ? <><br />{t.payout_ref} ({t.payout_status})</> : null}</td>
                <td className="text-xs text-ink-soft">{t.qb_bill ? `${t.qb_bill} (${t.qb_status})` : "—"}</td>
                <td className="max-w-[220px] text-[11px]">{t.problems.length === 0 ? <span className="text-[var(--cc-green)]">Payment verified</span>
                  : t.status === "paid" || ["reversed", "canceled", "ineligible"].includes(t.status) ? <span className="text-ink-soft">{t.problems.map((x) => PROBLEM[x] ?? x).join(", ")}</span>
                  : <span className="text-[var(--cc-amber)]">{t.problems.map((x) => PROBLEM[x] ?? x).join(", ")}</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Standing authorization">
        <form action={saveReconSettings} className="space-y-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" name="auto_approve" defaultChecked={o.settings.auto_approve_statements} disabled={!owner} className="mt-1" />
            <span><span className="text-white">Approve ordinary sales statements automatically</span><br /><span className="text-xs text-ink-soft">From day <input name="from_day" type="number" min={1} max={28} defaultValue={o.settings.auto_approve_from_day} disabled={!owner} className="field field-sm w-14" aria-label="Approval day" /> of each month, a closed statement is approved when every line&apos;s customer payment is verified in Stripe, past the 30-day refund hold, with no refund or chargeback, and the total is at most <input name="limit" defaultValue={(o.settings.auto_approve_limit_cents / 100).toFixed(0)} disabled={!owner} className="field field-sm w-24" aria-label="Limit in dollars" /> dollars. Bonus lines, partial refunds, larger totals and anything unverified wait for you. Payout limits, holds and the live activation checklist still apply.</span></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="qb_auto_bills" defaultChecked={o.settings.qb_auto_bills} disabled={!owner} className="mt-1" />
            <span><span className="text-white">Create QuickBooks bills automatically</span><br /><span className="text-xs text-ink-soft">While automatic payouts are off, every approved, verified obligation becomes a bill in Built2Bid&apos;s QuickBooks each morning (same rules as the manual button). You still pay bills in QuickBooks; paid bills are picked up automatically.</span></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="qb_provider" defaultChecked={o.settings.qb_record_provider_payouts} disabled={!owner} className="mt-1" />
            <span><span className="text-white">Book automatic payouts in QuickBooks</span><br /><span className="text-xs text-ink-soft">When the payment provider confirms a live payout, record a bill and a bill payment from this bank account (bookkeeping only, no money moves):</span>{" "}
              {banks ? <select name="qb_payment_account" defaultValue={o.settings.qb_payment_account_id ?? ""} disabled={!owner} className="field field-sm" aria-label="QuickBooks bank account"><option value="">Choose a bank account</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                : <span className="text-xs text-ink-soft">{o.settings.qb_payment_account_name ?? "connect live QuickBooks to choose"}</span>}</span></label>
          {owner ? (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-xs text-ink-soft"><input type="checkbox" name="confirm" /> I authorize these rules to run without asking me each month</label>
              <button className={btn}>Save</button>
              {o.settings.authorized_at && <span className="text-[11px] text-ink-soft">Last authorized {ct(o.settings.authorized_at)}</span>}
            </div>
          ) : <p className="text-xs text-ink-soft">Only the owner can change these.</p>}
        </form>
        <p className="mt-3 text-[11px] text-ink-soft">Real transfers need the automatic payout rail (Stripe Global Payouts, pending Stripe&apos;s approval) and the live activation checklist on the <Link className="underline" href="/admin/payouts?tab=settings">Automation &amp; activation</Link> tab.</p>
      </Panel>
    </div>
  );
}
