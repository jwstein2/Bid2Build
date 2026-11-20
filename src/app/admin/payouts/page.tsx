import Link from "next/link";
import { PageHead, Panel, Chip, Empty, Mini, Segmented, Table } from "@/components/admin/cc";
import { requireStaffCap, hasTwoStep, TWO_STEP_FINANCE } from "@/lib/staff/server";
import { PayoutLedger, type PayoutRow } from "@/components/payouts/ledger";
import { CLASSIFICATION, FEE_REASON, HOLD_REASON, feeLine, money, type FeePolicy } from "@/lib/payouts/labels";
import { activateLive, approveFeePolicy, approveFunding, approvePayout, cancelPayout, pause, reconcile, runNow, saveLimits, saveMode, saveThreshold, simulate } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments & Payouts" };

type Settings = { mode: "off" | "test" | "live"; provider: string; paused: boolean; paused_reason: string | null; per_payout_limit_cents: number; daily_limit_cents: number; review_above_cents: number;
  bank_change_hold_hours: number; pay_delay_days: number; min_payout_cents: number; fee_recovery_blocked_states: string[]; fee_policy_id: string | null; funding_label: string | null;
  funding_approved_at: string | null; live_activated_at: string | null };
type Fee = FeePolicy & { id: string; version: number; provider: string; instant_enabled: boolean; monthly_account_cents: number; disclosure: string; source_note: string; approved_at: string | null };
type Overview = { settings: Settings; fee_policies: Fee[]; payouts: PayoutRow[]; exceptions: { statement_id: string; period_month: string; total_cents: number; rep_name: string; staff_id: string | null; reason: string }[];
  liabilities: { approved_unpaid_cents: number; earned_unapproved_cents: number; pending_cents: number }; recipients: number };

const OK: Record<string, string> = { mode: "Mode saved.", limits: "Limits saved.", paused: "All payouts paused.", resumed: "Payouts resumed.", fees: "Fee schedule approved. Recipient-paid fees apply only to people who accepted this disclosure.",
  funding: "Funding account approved. Live activation (if any) was cleared and needs to be done again.", live: "Live payouts activated.", approved: "Payout approved.", canceled: "Payout canceled; its statements can be paid again.",
  sim_posted: "Simulated: settled.", sim_failed: "Simulated: failed.", sim_returned: "Simulated: returned by bank.", ran: "Run finished.", reconciled: "Saved.", threshold: "Threshold saved." };
const ERR: Record<string, string> = { two_step: TWO_STEP_FINANCE, env_live: "PAYOUTS_ALLOW_LIVE isn't 'true' on the server. Set it in Netlify (Production) and redeploy first.", confirm: "Tick the confirmation box.",
  provider_is_mock: "Switch the provider to Stripe Global Payouts first.", funding_not_approved: "Approve the funding account first.", fee_policy_not_approved: "Approve the fee schedule first.",
  use_activation: "Use the live activation checklist.", owner_only: "Owner only.", invalid: "Please check the form." };
const btn = "cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]";
const CHECKLIST: [string, string][] = [
  ["provider_approved", "Stripe approved Built2Bid for Global Payouts (paying our own US contractors) on the live account"],
  ["provider_live_keys", "PAYOUTS_PROVIDER_KEY (live), PAYOUTS_ALLOW_LIVE=true and STRIPE_PAYOUTS_WEBHOOK_SECRET are set in Netlify Production, and the event destination is created"],
  ["funding_confirmed", "The Stripe payout balance is funded from the business account named above, and I know how to top it up"],
  ["fee_policy_reviewed", "The recipient fee schedule matches the live account's actual Global Payouts pricing"],
  ["agreements_reviewed_by_counsel", "Counsel reviewed the contractor, commission, payment-terms and fee-disclosure agreements (and MN wage rules for any W-2 staff)"],
  ["tax_reporting_plan", "I have a 1099-NEC filing plan for this tax year (threshold verified, filing provider or accountant chosen)"],
  ["classification_reviewed", "Every person who will be paid has a reviewed classification"],
  ["limits_reviewed", "Per-payout, daily and approval limits are set to amounts I'm comfortable sending automatically"],
  ["test_run_passed", "A full test-mode run (connect bank, schedule, send, settle, fail, return) worked as expected"],
];

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; err?: string; summary?: string; status?: string; year?: string; month?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const { user, db, owner } = await requireStaffCap("payouts.view");
  const { data, error } = await db.rpc("admin_payouts_overview", { p_caller: user.id });
  if (error || !data) return <div className="space-y-6"><PageHead kicker="Administration" title="Payments & Payouts" /><Panel title="Not installed"><p className="text-sm text-ink-soft">Run migration 20270207001000_staff_payouts.sql first.</p></Panel></div>;
  const o = data as Overview;
  const s = o.settings;
  const fee = o.fee_policies.find((f) => f.id === s.fee_policy_id) ?? null;
  const twoStep = owner ? await hasTwoStep() : false;
  const by = (st: string[]) => o.payouts.filter((p) => st.includes(p.status));
  const scheduled = by(["scheduled", "needs_approval", "held"]);
  const transit = by(["submitting", "submitted"]);
  const failed = by(["failed", "returned"]);
  const paidLive = o.payouts.filter((p) => p.status === "paid" && p.mode === "live");
  const tabs = [["overview", "Overview"], ["ledger", "All payouts"], ["exceptions", "Exceptions"], ["settings", "Automation & activation"], ["tax", "Year-end tax"], ["costs", "Cost report"]]
    .map(([v, l]) => ({ value: v, label: l, href: `/admin/payouts?tab=${v}` }));
  const ownerActions = (p: PayoutRow) => owner ? (
    <div className="flex flex-col gap-1">
      {p.status === "needs_approval" && <form action={approvePayout}><input type="hidden" name="id" value={p.id} /><button className={btn}>Approve</button></form>}
      {["scheduled", "held", "needs_approval"].includes(p.status) && <form action={cancelPayout}><input type="hidden" name="id" value={p.id} /><button className={btn}>Cancel</button></form>}
      {p.mode === "test" && p.provider === "mock" && p.status === "submitted" && (["posted", "failed", "returned"] as const).map((k) =>
        <form key={k} action={simulate}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value={k} /><button className={btn}>Simulate {k === "posted" ? "settled" : k}</button></form>)}
      {p.mode === "test" && p.provider === "mock" && p.status === "paid" && <form action={simulate}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="returned" /><button className={btn}>Simulate return</button></form>}
      {["paid", "returned"].includes(p.status) && <ReconForm id={p.id} />}
    </div>
  ) : ["paid", "returned"].includes(p.status) ? <ReconForm id={p.id} /> : null;

  return (
    <div className="space-y-6">
      <PageHead kicker="Administration" title="Payments & Payouts" intro="Contractor payouts from approved Sales Hub statements, one batched ACH per person per pay date. W-2 pay goes through payroll."
        right={<div className="flex items-center gap-2">
          <Chip tone={s.mode === "live" ? "green" : s.mode === "test" ? "blue" : "muted"}>{s.mode === "live" ? "LIVE" : s.mode === "test" ? "TEST MODE" : "AUTOMATION OFF"}</Chip>
          {s.paused && <Chip tone="red">PAUSED</Chip>}
          <a href="/api/payouts/export" className={btn}>Export CSV</a>
        </div>} />
      {sp.ok && <p role="status" className="cc-mono rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-xs text-[var(--cc-green)]">{OK[sp.ok] ?? "Done."}{sp.summary ? ` ${sp.summary}` : ""}</p>}
      {sp.err && <p role="alert" className="cc-mono rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-xs text-[var(--cc-red)]">{ERR[sp.err] ?? (sp.err.startsWith("checklist_incomplete") ? "Every checklist item must be confirmed." : sp.err)}</p>}
      <Segmented options={tabs} active={tab} />

      {tab === "overview" && (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Mini label="Scheduled / held" value={scheduled.length} tone={scheduled.some((p) => p.status !== "scheduled") ? "amber" : "blue"} />
          <Mini label="In transit" value={transit.length} tone="violet" />
          <Mini label="Failed / returned" value={failed.length} tone={failed.length ? "red" : "muted"} />
          <Mini label="Paid (live, all time)" value={money(paidLive.reduce((n, p) => n + p.net_cents, 0))} tone="green" />
          <Mini label="Approved, unpaid" value={money(o.liabilities.approved_unpaid_cents)} tone="amber" />
          <Mini label="Earned, awaiting approval" value={money(o.liabilities.earned_unapproved_cents)} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Panel title="Scheduled, held and in transit"><PayoutLedger rows={[...scheduled, ...transit]} actions={ownerActions} /></Panel>
          <div className="space-y-6">
            <Panel title="Emergency control">
              {owner ? (
                <form action={pause} className="space-y-2">
                  <input type="hidden" name="paused" value={s.paused ? "0" : "1"} />
                  {!s.paused && <input name="reason" maxLength={500} placeholder="Reason (optional)" className="field field-sm w-full" />}
                  <button className={s.paused ? btn : "cc-mono w-full rounded-md bg-[var(--cc-red)] px-3 py-2 text-xs font-bold text-black"}>{s.paused ? "Resume payouts (needs two-step)" : "Pause all payouts now"}</button>
                  {s.paused && s.paused_reason && <p className="text-xs text-ink-soft">Paused: {s.paused_reason}</p>}
                </form>
              ) : <p className="text-xs text-ink-soft">Only the owner can pause or resume payouts.</p>}
              {owner && s.mode !== "off" && <form action={runNow} className="mt-3"><button className={btn}>Run payouts now</button><p className="mt-1 text-[11px] text-ink-soft">The daily run is 9:10 AM Central. {s.mode === "test" ? "Test mode: no money moves." : ""}</p></form>}
            </Panel>
            <Panel title="Alerts">
              <ul className="space-y-1 text-xs">
                {failed.map((p) => <li key={p.id} className="text-[var(--cc-red)]">{p.ref}: {p.status} ({p.staff_name})</li>)}
                {by(["needs_approval"]).map((p) => <li key={p.id} className="text-[var(--cc-amber)]">{p.ref} waits for your approval ({money(p.net_cents)})</li>)}
                {by(["held"]).map((p) => <li key={p.id} className="text-[var(--cc-amber)]">{p.ref} held: {p.hold_reasons.map((h) => HOLD_REASON[h] ?? h).join(", ")}</li>)}
                {o.exceptions.length > 0 && <li className="text-[var(--cc-amber)]"><Link className="underline" href="/admin/payouts?tab=exceptions">{o.exceptions.length} approved statement(s) can&apos;t use contractor ACH</Link></li>}
                {!fee?.approved_at && <li className="text-ink-soft">Fee schedule not approved: Built2Bid pays every transfer fee for now.</li>}
                {o.payouts.filter((p) => p.status === "paid" && p.gross_cents > 0 && p.fee_cents / p.gross_cents > 0.02).map((p) => <li key={p.id} className="text-[var(--cc-amber)]">{p.ref}: fee above 2% of the payment</li>)}
                {failed.length + by(["needs_approval", "held"]).length + o.exceptions.length === 0 && <li className="text-ink-soft">Nothing needs attention.</li>}
              </ul>
            </Panel>
            <Panel title="Payroll"><p className="text-xs text-ink-soft"><span className="text-[var(--cc-amber)]">Payroll Integration Required.</span> W-2 staff are onboarded and tracked here, but no wages are paid or shown as paid until a payroll provider is connected (none purchased).</p></Panel>
          </div>
        </div>
      </>)}

      {tab === "ledger" && (
        <Panel title="All payouts" action={<form className="flex gap-2"><input type="hidden" name="tab" value="ledger" /><select name="status" defaultValue={sp.status ?? ""} className="field field-sm"><option value="">All</option>{["scheduled", "held", "needs_approval", "submitted", "paid", "failed", "returned", "canceled"].map((x) => <option key={x}>{x}</option>)}</select><button className={btn}>Filter</button></form>}>
          <PayoutLedger rows={o.payouts.filter((p) => !sp.status || p.status === sp.status)} actions={ownerActions} />
        </Panel>
      )}

      {tab === "exceptions" && (
        <Panel title="Approved statements not paid by contractor ACH">
          {o.exceptions.length === 0 ? <Empty>None.</Empty> : (
            <Table head={["Rep", "Statement", "Amount", "Why", ""]}>
              {o.exceptions.map((e) => (
                <tr key={e.statement_id}><td className="text-white">{e.rep_name}</td><td className="text-ink-soft">{e.period_month.slice(0, 7)}</td><td className="text-white">{money(e.total_cents)}</td>
                  <td className="text-xs text-[var(--cc-amber)]">{e.reason === "payroll_required" ? "W-2 employee: pay through payroll" : e.reason === "classification_review" ? "Classification not reviewed" : e.reason === "no_staff_record" ? "Not in the staff directory" : e.reason}</td>
                  <td>{e.staff_id && <Link className="text-xs text-[var(--cc-blue)] underline" href={`/admin/staff/${e.staff_id}`}>Open person</Link>}</td></tr>))}
            </Table>
          )}
          <p className="mt-3 text-xs text-ink-soft">These stay approved and owed. Record a manual or payroll payment in the Sales Hub (Statements &amp; payouts) once paid there.</p>
        </Panel>
      )}

      {tab === "settings" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Mode and provider">
            <p className="mb-3 text-xs text-ink-soft">Off: nothing runs. Test: the daily run schedules and &quot;sends&quot; with the practice provider (or a Stripe sandbox key); no money moves and no real statement is marked paid. Live needs the activation below.</p>
            {owner && s.mode !== "live" ? (
              <form action={saveMode} className="flex flex-wrap items-end gap-2">
                <label className="text-xs"><span className="cc-kicker mb-1 block">Mode</span><select name="mode" defaultValue={s.mode} className="field field-sm"><option value="off">Off</option><option value="test">Test</option></select></label>
                <label className="text-xs"><span className="cc-kicker mb-1 block">Provider</span><select name="provider" defaultValue={s.provider} className="field field-sm"><option value="mock">Practice (in-app)</option><option value="stripe_global_payouts">Stripe Global Payouts</option></select></label>
                <button className={btn}>Save</button>
              </form>
            ) : s.mode === "live" ? <p className="text-sm text-[var(--cc-green)]">Live since {new Date(s.live_activated_at!).toLocaleString()}. Switching back to Test or Off clears the activation.</p> : null}
            {owner && s.mode === "live" && <form action={saveMode} className="mt-2"><input type="hidden" name="mode" value="test" /><input type="hidden" name="provider" value={s.provider} /><button className={btn}>Leave live mode</button></form>}
          </Panel>
          <Panel title="Limits and schedule">
            <form action={saveLimits} className="grid grid-cols-2 gap-2 text-xs">
              <Field label="Per-payout limit ($)" name="per_payout" v={s.per_payout_limit_cents / 100} />
              <Field label="Daily limit ($)" name="daily" v={s.daily_limit_cents / 100} />
              <Field label="Owner approval above ($)" name="review_above" v={s.review_above_cents / 100} />
              <Field label="New-bank hold (hours)" name="hold_hours" v={s.bank_change_hold_hours} />
              <Field label="Pay date: days after approval" name="delay_days" v={s.pay_delay_days} />
              <Field label="Minimum payout ($, 0 = none)" name="min_payout" v={s.min_payout_cents / 100} />
              <label className="col-span-2"><span className="cc-kicker mb-1 block">States where recipient fees are never deducted</span><input name="blocked_states" defaultValue={s.fee_recovery_blocked_states.join(", ")} className="field field-sm w-full" placeholder="e.g. CA, NY" /></label>
              {owner && <button className={`${btn} col-span-2`}>Save limits (needs two-step)</button>}
            </form>
            <p className="mt-2 text-[11px] text-ink-soft">Payouts within these limits send without your approval once automation is on. A minimum payout only applies if the person&apos;s agreement allows it; earned pay is never delayed to save fees.</p>
          </Panel>
          <Panel title="Recipient fee schedule">
            {fee ? (<>
              <p className="text-sm text-white">v{fee.version}: {feeLine(fee)}{fee.instant_enabled ? `; instant ${money(fee.instant_fixed_cents)} + ${(fee.instant_bps / 100).toFixed(2)}% (min ${money(fee.instant_min_cents)})` : "; instant payouts off"}</p>
              <p className="mt-1 text-xs text-ink-soft">{fee.source_note}</p>
              <p className="mt-2 text-xs text-ink-soft">{fee.approved_at ? `Approved ${new Date(fee.approved_at).toLocaleDateString()}.` : "Not approved: Built2Bid pays every fee until you approve it."} Recipients pay only after accepting this exact version; W-2 staff, people who haven&apos;t accepted, blocked states and payouts smaller than the fee always fall back to Built2Bid.</p>
              {owner && !fee.approved_at && <form action={approveFeePolicy} className="mt-2 space-y-2"><input type="hidden" name="version" value={fee.version} /><label className="flex items-center gap-2 text-xs text-white"><input type="checkbox" name="confirm" /> The amounts match the provider&apos;s actual charge (no markup)</label><button className={btn}>Approve fee schedule (needs two-step)</button></form>}
            </>) : <Empty>No fee schedule.</Empty>}
          </Panel>
          <Panel title="Funding account">
            <p className="text-xs text-ink-soft">Global Payouts pays from Built2Bid&apos;s Stripe storage balance, which you top up from the business bank. Naming and approving the account is required before going live; changing it clears live activation.</p>
            <p className="mt-2 text-sm text-white">{s.funding_label ? `${s.funding_label} · approved ${new Date(s.funding_approved_at!).toLocaleDateString()}` : "Not set"}</p>
            {owner && <form action={approveFunding} className="mt-2 flex gap-2"><input name="label" required minLength={3} maxLength={200} placeholder="e.g. Stripe balance ← Business checking ••4821" className="field field-sm flex-1" /><button className={btn}>Approve</button></form>}
          </Panel>
          <Panel title="Live activation (owner only)" className="lg:col-span-2">
            {s.mode === "live" ? <p className="text-sm text-[var(--cc-green)]">Live payouts are on. Routine payouts within limits send automatically; you can pause at any time.</p> : (
              <form action={activateLive} className="space-y-2">
                {CHECKLIST.map(([k, l]) => <label key={k} className="flex items-start gap-2 text-xs text-white"><input type="checkbox" name={k} className="mt-0.5" />{l}</label>)}
                <input name="typed_name" required maxLength={120} placeholder="Type your full name to authorize" className="field field-sm w-72" />
                <div><button disabled={!owner || !twoStep} className="cc-mono rounded-md bg-[var(--cc-green)] px-4 py-2 text-xs font-bold text-black disabled:opacity-40">Activate live payouts</button>
                  {owner && !twoStep && <span className="ml-3 text-xs text-[var(--cc-amber)]">{TWO_STEP_FINANCE}</span>}</div>
                <p className="text-[11px] text-ink-soft">Also refused unless the server has PAYOUTS_ALLOW_LIVE=true, the provider is Stripe Global Payouts, the funding account and the fee schedule are approved. Test payouts are never re-sent live.</p>
              </form>
            )}
          </Panel>
        </div>
      )}

      {tab === "tax" && <TaxTab db={db} caller={user.id} year={Number(sp.year) || new Date().getFullYear()} owner={owner} />}
      {tab === "costs" && <CostTab db={db} caller={user.id} month={sp.month ?? new Date().toISOString().slice(0, 7)} />}
    </div>
  );
}

function Field({ label, name, v }: { label: string; name: string; v: number }) {
  return <label><span className="cc-kicker mb-1 block">{label}</span><input name={name} defaultValue={String(v)} inputMode="decimal" className="field field-sm w-full" /></label>;
}

function ReconForm({ id }: { id: string }) {
  return (
    <form action={reconcile} className="flex gap-1"><input type="hidden" name="id" value={id} />
      <select name="state" className="field field-sm !py-0.5 text-[11px]"><option value="matched">Matched</option><option value="exception">Exception</option><option value="unreconciled">Unreconciled</option><option value="not_applicable">N/A</option></select>
      <button className="cc-mono rounded border border-[var(--cc-line)] px-1.5 text-[11px] text-white">Save</button></form>
  );
}

type Db = Awaited<ReturnType<typeof requireStaffCap>>["db"];
async function TaxTab({ db, caller, year, owner }: { db: Db; caller: string; year: number; owner: boolean }) {
  const { data } = await db.rpc("admin_payout_tax_year", { p_caller: caller, p_year: year });
  const t = data as { threshold: { threshold_cents: number; verified: boolean; source_note: string } | null; people: { staff_id: string; name: string; classification: string; gross_paid_cents: number; fees_recipient_cents: number; net_paid_cents: number;
    w9_status: string; tin_on_file: boolean; likely_exempt: boolean; over_threshold: boolean; missing: string[] }[]; employees: { staff_id: string; name: string }[] } | null;
  if (!t) return <Empty>Not available.</Empty>;
  return (
    <div className="space-y-6">
      <Panel title={`1099-NEC readiness, ${year}`} action={<Segmented active={String(year)} options={[year - 1, year, year + 1].map((y) => ({ value: String(y), label: String(y), href: `/admin/payouts?tab=tax&year=${y}` }))} />}>
        <p className="mb-3 text-xs text-ink-soft">Threshold for {year}: {t.threshold ? `${money(t.threshold.threshold_cents)} ${t.threshold.verified ? "(verified)" : "(NOT verified)"} · ${t.threshold.source_note}` : "not set: enter it below"}. Amounts are GROSS compensation actually paid in live mode (fees deducted from a payout don&apos;t reduce it; confirm the treatment with your accountant). ACH you send is reported by Built2Bid on 1099-NEC, not by the payment processor on 1099-K. Nothing is filed automatically.</p>
        {t.people.length === 0 ? <Empty>No contractors.</Empty> : (
          <Table head={["Payee", "Gross paid", "Fees (recipient)", "Net", "W-9 / TIN", "Status"]}>
            {t.people.map((p) => (
              <tr key={p.staff_id}><td className="text-white">{p.name}<div className="text-[11px] text-ink-soft">{CLASSIFICATION[p.classification]}</div></td><td className="text-white">{money(p.gross_paid_cents)}</td><td>{money(p.fees_recipient_cents)}</td><td>{money(p.net_paid_cents)}</td>
                <td className="text-xs">{p.w9_status}{p.tin_on_file ? " · TIN on file" : ""}</td>
                <td className="text-xs">{p.likely_exempt ? <Chip tone="muted">Corporation: likely exempt</Chip> : p.over_threshold ? <Chip tone="amber">Over threshold: 1099-NEC</Chip> : <Chip tone="muted">Under threshold</Chip>}
                  {p.missing.length > 0 && <div className="text-[11px] text-[var(--cc-red)]">Missing: {p.missing.join(", ")}</div>}</td></tr>))}
          </Table>
        )}
      </Panel>
      {owner && (
        <Panel title="Set the threshold for a tax year">
          <form action={saveThreshold} className="flex flex-wrap items-end gap-2 text-xs">
            <label><span className="cc-kicker mb-1 block">Year</span><input name="year" defaultValue={year} className="field field-sm w-24" /></label>
            <label><span className="cc-kicker mb-1 block">Threshold ($)</span><input name="threshold" defaultValue={t.threshold ? t.threshold.threshold_cents / 100 : ""} className="field field-sm w-28" /></label>
            <label className="flex-1"><span className="cc-kicker mb-1 block">Source</span><input name="note" defaultValue={t.threshold?.source_note ?? ""} className="field field-sm w-full" /></label>
            <label className="flex items-center gap-1 text-white"><input type="checkbox" name="verified" defaultChecked={t.threshold?.verified} /> Verified</label>
            <button className={btn}>Save (needs two-step)</button>
          </form>
        </Panel>
      )}
      <Panel title="W-2 employees"><p className="text-xs text-ink-soft">{t.employees.length} employee(s). W-2 forms come from the payroll provider once connected (Payroll Integration Required).</p></Panel>
    </div>
  );
}

async function CostTab({ db, caller, month }: { db: Db; caller: string; month: string }) {
  const { data } = await db.rpc("admin_payout_cost_report", { p_caller: caller, p_month: `${month}-01` });
  const c = data as { recipients: number; transfers: number; gross_cents: number; provider_fees_cents: number; recipient_fees_cents: number; company_fees_cents: number; unrecoverable: Record<string, number>;
    avg_cost_per_recipient_cents: number | null; monthly_account_cents: number; items_batched: number; batching_savings_cents: number; returned: number; mode: string } | null;
  const prev = new Date(`${month}-15T12:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1);
  return (
    <div className="space-y-6">
      <Panel title={`Payout cost report, ${month}`} action={<Link className={btn} href={`/admin/payouts?tab=costs&month=${prev.toISOString().slice(0, 7)}`}>← Previous month</Link>}>
        {!c ? <Empty>No data.</Empty> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Mini label="Active payout recipients" value={c.recipients} /><Mini label="ACH transfers" value={c.transfers} /><Mini label="Gross compensation" value={money(c.gross_cents)} />
            <Mini label="Provider fees" value={money(c.provider_fees_cents)} /><Mini label="Paid by recipients" value={money(c.recipient_fees_cents)} tone="green" /><Mini label="Paid by Built2Bid" value={money(c.company_fees_cents)} tone={c.company_fees_cents ? "amber" : "muted"} />
            <Mini label="Avg cost per recipient" value={money(c.avg_cost_per_recipient_cents)} /><Mini label="Saved by batching" value={money(c.batching_savings_cents)} tone="green" />
          </div>
        )}
        {c && Object.keys(c.unrecoverable).length > 0 && <p className="mt-3 text-xs text-ink-soft">Why Built2Bid paid: {Object.entries(c.unrecoverable).map(([k, n]) => `${FEE_REASON[k] ?? k} (${n})`).join(", ")}</p>}
        {c?.mode === "test" && <p className="mt-2 text-xs text-ink-soft">Includes test-mode payouts (no real fees were charged).</p>}
      </Panel>
      <Panel title="Provider comparison (per $500 standard ACH payout, public US pricing checked 2026-11-20)">
        <Table head={["Option", "Per payout", "Monthly per recipient", "Fits paying our own contractors?", "Notes"]}>
          <tr><td className="text-white">Stripe Global Payouts (recommended)</td><td>$1.50</td><td>$0</td><td>Yes: built for paying recipients (contractors, freelancers)</td><td className="text-xs">Funded from the Stripe storage balance (top-ups). Needs Stripe approval. Debit-card (instant) $1.50 + 0.75%, min $2. Wires $25.</td></tr>
          <tr><td className="text-white">Stripe Connect (Express, platform pays)</td><td>$1.50 (0.25% + $0.25)</td><td>$2 per active account</td><td>Mainly for marketplaces; connected accounts are businesses selling through a platform</td><td className="text-xs">Instant payouts 1%. Built2Bid&apos;s live account has no Connect platform set up.</td></tr>
          <tr><td className="text-white">Existing Stripe subscriptions setup</td><td>—</td><td>—</td><td>No: it can only collect money from customers</td><td className="text-xs">Stripe payouts go only to Built2Bid&apos;s own bank.</td></tr>
          <tr><td className="text-white">Manual ACH from the business bank</td><td>Bank&apos;s fee</td><td>Bank&apos;s fee</td><td>Yes, but not automated</td><td className="text-xs">Keeps the Sales Hub &quot;record payout&quot; flow; no automation.</td></tr>
        </Table>
      </Panel>
    </div>
  );
}
