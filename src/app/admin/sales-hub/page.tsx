import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { repLink } from "@/lib/sales/link";
import { COMMISSION_STATUS, dateLabel, METHOD_LABEL, plural, monthLabel, reasonLabel, TIER_LABEL, usd, yearLabel } from "@/lib/sales/format";
import type { Hub, HubRep } from "@/lib/sales/types";
import { SOURCE_LABEL, STAGE_LABEL, TRADES, type Lead } from "@/lib/sales/crm";
import { adjustCommission, approveStatement, assignCustomer, assignLeads, importLeads, saveLeadTarget, closeMonth, endAttribution, recordPayout, savePolicy, saveRep } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales Hub" };

const TABS = [
  ["overview", "Overview"], ["team", "Sales team"], ["leads", "Leads"], ["customers", "Customers"], ["commissions", "Commissions"], ["statements", "Statements & payouts"], ["policy", "Policy"],
] as const;
type Tab = (typeof TABS)[number][0];

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold";
const REP_STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "brand" | "accent" }> = {
  invited: { label: "Invited", tone: "accent" }, active: { label: "Active", tone: "ok" }, suspended: { label: "Suspended", tone: "warn" }, removed: { label: "Removed", tone: "neutral" },
};

const POLICY = {
  annual_basis: { divide_12: "Annual price ÷ 12 ($149 → $12.42)", monthly_list: "Monthly list price ($19.99)", full_payment: "Full annual payment ($149)" },
  refund_policy: {
    month_end_clawback: "Hold to month end; refund before payout voids it, after payout it's deducted from the next statement",
    hold_30_no_clawback: "Hold 30 days after payment; refunds inside the window void it, later refunds never affect the rep",
    never_reverse: "Pay on payment, never reverse",
  },
  value_scope: { plan_seats: "Plan + Enterprise seats (add-ons excluded)", all_items: "Everything on the subscription", base_plan: "Base plan only" },
} as const;

function RepFields({ r }: { r?: HubRep }) {
  return (
    <>
      {r && <input type="hidden" name="id" value={r.id} />}
      {!r && <input type="hidden" name="id" value="" />}
      <label className="text-sm">Full name<input name="full_name" required maxLength={120} defaultValue={r?.full_name} className={input} /></label>
      <label className="text-sm">Email{r?.linked && <span className="text-xs text-muted"> (locked after first sign-in)</span>}<input name="email" type="email" required defaultValue={r?.email} readOnly={r?.linked} className={input} /></label>
      <label className="text-sm">Phone<input name="phone" maxLength={40} defaultValue={r?.phone ?? ""} className={input} /></label>
      <label className="text-sm">Role
        <select name="role" defaultValue={r?.role ?? "rep"} className={input}><option value="rep">Sales rep</option><option value="manager">Sales manager</option></select>
      </label>
      <label className="text-sm">Access
        <select name="status" defaultValue={r?.status === "invited" ? "active" : r?.status ?? "active"} className={input}>
          <option value="active">Active</option><option value="suspended">Suspended (can&apos;t sign in, link stops counting)</option><option value="removed">Removed</option>
        </select>
      </label>
      <label className="text-sm">How you pay them<input name="payout_note" maxLength={300} placeholder="e.g. ACH via payroll. No bank numbers." defaultValue={r?.payout_note ?? ""} className={input} /></label>
    </>
  );
}

export default async function SalesHub({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; err?: string; status?: string; rep?: string }> }) {
  const { user, db } = await requireAdmin();
  const sp = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "overview") as Tab;
  const { data, error } = await db.rpc("admin_sales_hub", { p_caller: user.id });
  if (error || !data) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Sales Hub</h1>
        <p className="text-ink-soft">The sales tables are not installed yet. Run <code className="break-all">supabase/migrations/20270107001000_sales_portal.sql</code> in the Supabase SQL Editor, then reload.</p>
      </div>
    );
  }
  const h = data as Hub;
  const crm = tab === "leads" ? await db.rpc("admin_sales_crm", { p_caller: user.id }) : null;
  const leads = ((crm?.data as { leads?: Lead[] } | null)?.leads ?? []).filter((l) => (!sp.rep || (sp.rep === "none" ? !l.assigned_rep : l.assigned_rep === sp.rep)) && (sp.status !== "agent" || l.source === "agent"));
  // Weekly automated import history (Phase 3a). Missing until that migration is run: the panel is hidden.
  const imports = tab === "leads" ? await db.rpc("admin_sales_import_batches", { p_caller: user.id }) : null;
  const importData = imports && !imports.error ? (imports.data as { batches: { id: string; label: string | null; received: number; added: number; duplicates: number; suppressed: number; invalid: number; unverified?: number; target_zip?: string | null; target_trade?: string | null; created_at: string }[]; unassigned_agent: number; suppressed: number;
    target?: { zip: string | null; trade: string | null; radius_miles: number; count: number; paused: boolean }; zips?: { zip: string; leads: number }[] }) : null;
  const activeReps = h.reps.filter((r) => r.status !== "removed");
  const sumStatus = (s: string[]) => h.commissions.filter((c) => s.includes(c.status)).reduce((t, c) => t + c.amount_cents, 0);
  const errText = sp.err ? ({
    owner_cannot_be_rep: "That email belongs to an owner account. Sales staff need their own email.",
    reason_required: "Add a short reason; it is kept in the audit log.", customer_not_found: "No Built2Bid account uses that email.",
    rep_not_found: "Pick an active sales team member.", customer_is_sales_staff: "That account belongs to sales staff.",
    policy_not_confirmed: "Confirm the commission policy (Policy tab) before approving statements.", already_approved: "That statement was already approved.",
    already_paid: "A payout was already recorded for that statement.", approve_first: "Approve the statement before recording its payout.",
    locked_after_approval: "Approved and paid lines can't be changed.", duplicate: "Someone with that email is already on the sales team.",
  } as Record<string, string>)[sp.err] ?? "That didn't work. Check the form and try again." : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Sales Hub</h1>
          <p className="mt-1 text-sm text-ink-soft">Your sales team, their customers, commissions and payouts. Reps sign in at <a className="underline" href="/sales">built2bid.org/sales</a>. Separate from the customer referral program.</p>
        </div>
      </div>
      {!h.settings.policy_confirmed_at && (
        <Notice tone="warn" title="Commission policy not confirmed yet">Commissions are tracked with the default rules, but statements can&apos;t be approved until you confirm the policy. <Link className="underline" href="/admin/sales-hub?tab=policy">Review policy</Link></Notice>
      )}
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {errText && <Notice tone="danger">{errText}</Notice>}

      <nav aria-label="Sales Hub" className="flex gap-1 overflow-x-auto border-b border-line text-sm">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/admin/sales-hub?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 font-semibold ${tab === k ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>{label}</Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {([
              ["Active reps", activeReps.filter((r) => r.status === "active").length, `${activeReps.filter((r) => r.status === "invited").length} invited`],
              ["Link visits", h.reps.reduce((t, r) => t + r.visits, 0), undefined],
              ["Attributed accounts", h.attributions.length, undefined],
              ["Paying now", h.reps.reduce((t, r) => t + r.paying, 0), undefined],
              ["Owed (earned)", usd(sumStatus(["earned", "approved"])), `${usd(sumStatus(["pending"]))} pending this month`],
              ["Paid all time", usd(sumStatus(["paid"])), undefined],
            ] as [string, string | number, string | undefined][]).map(([k, v, sub]) => (
              <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-2xl font-extrabold">{v}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</Card>
            ))}
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Rep</th><th className="p-3">Visits</th><th className="p-3">Accounts</th><th className="p-3">Paying</th><th className="p-3">Pending</th><th className="p-3">Owed</th><th className="p-3">Paid</th></tr></thead>
              <tbody>
                {activeReps.length === 0 && <tr><td colSpan={7} className="p-4 text-ink-soft">No sales staff yet. Add your first rep on the <Link className="underline" href="/admin/sales-hub?tab=team">Sales team</Link> tab.</td></tr>}
                {activeReps.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="p-3"><p className="font-semibold">{r.full_name} <Badge tone={REP_STATUS[r.status]?.tone}>{REP_STATUS[r.status]?.label}</Badge></p><p className="text-xs text-muted">{r.role === "manager" ? "Manager" : "Rep"} · {r.email}</p></td>
                    <td className="p-3">{r.visits}</td><td className="p-3">{r.signups}</td><td className="p-3">{r.paying}</td>
                    <td className="p-3">{usd(r.pending_cents)}</td><td className="p-3">{usd(r.earned_cents)}</td><td className="p-3">{usd(r.paid_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "team" && (
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Add a sales team member</h2>
            <p className="mt-1 text-sm text-ink-soft">They get a permanent referral link right away. Nothing is emailed: send them to <b>built2bid.org/sales</b> to sign in with this email. Sales staff never get owner or customer-account access.</p>
            <form action={saveRep} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <RepFields />
              <div className="sm:col-span-2 lg:col-span-3"><button className={btn}>Add to sales team</button></div>
            </form>
          </Card>
          {h.reps.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">{r.full_name} <Badge tone={REP_STATUS[r.status]?.tone}>{REP_STATUS[r.status]?.label}</Badge></p>
                  <p className="text-sm text-muted">{r.role === "manager" ? "Sales manager" : "Sales rep"} · {r.email}{r.phone ? ` · ${r.phone}` : ""} · added {dateLabel(r.created_at)}{r.activated_at ? `, first signed in ${dateLabel(r.activated_at)}` : ", hasn't signed in yet"}</p>
                  <p className="mt-1 break-all font-mono text-sm">{repLink(r.code)}</p>
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-brand">Edit</summary>
                <form action={saveRep} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <RepFields r={r} />
                  <div className="sm:col-span-2 lg:col-span-3"><button className={btn}>Save</button></div>
                </form>
              </details>
            </Card>
          ))}
        </div>
      )}

      {tab === "leads" && (
        crm?.error ? <Notice tone="warn">The CRM tables are not installed yet. Run <code className="break-all">supabase/migrations/20270107002000_sales_crm.sql</code> in the Supabase SQL Editor, then reload.</Notice> : (
        <div className="space-y-6">
          {importData && (
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Weekly lead import</h2>
                  <p className="mt-1 text-sm text-ink-soft">Businesses found by the weekly Claude agent arrive here unassigned. Duplicates and anyone marked do-not-contact ({importData.suppressed} on the list) are skipped automatically.</p>
                </div>
                {importData.unassigned_agent > 0 && <Link href="/admin/sales-hub?tab=leads&rep=none&status=agent" className="text-sm font-semibold text-brand underline">{importData.unassigned_agent} new to assign</Link>}
              </div>
              {importData.target && (
                <form action={saveLeadTarget} className="mt-4 grid gap-3 rounded-lg border border-line bg-paper p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                  <p className="text-sm font-semibold sm:col-span-4">Next run target{importData.target.zip ? `: ${importData.target.count} leads within ${importData.target.radius_miles} miles of ${importData.target.zip}${importData.target.trade ? `, ${importData.target.trade}` : ""}${importData.target.paused && importData.target.zip ? " (paused)" : ""}` : ": not set yet, so the weekly run is waiting"}</p>
                  <label className="text-sm">Active ZIP code
                    <input name="zip" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} list="lead-target-zips" defaultValue={importData.target.zip ?? ""} className={input} placeholder="55401" />
                    <datalist id="lead-target-zips">{(importData.zips ?? []).map((z) => <option key={z.zip} value={z.zip}>{`${z.leads} lead${z.leads === 1 ? "" : "s"}`}</option>)}</datalist>
                  </label>
                  <label className="text-sm">Trade
                    <select name="trade" defaultValue={importData.target.trade ?? ""} className={input}>
                      <option value="">All trades</option>
                      {TRADES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Miles<input name="radius" type="number" min={5} max={250} defaultValue={importData.target.radius_miles} className={`${input} w-24`} /></label>
                  <label className="text-sm">Leads per run<input name="count" type="number" min={1} max={200} defaultValue={importData.target.count} className={`${input} w-24`} /></label>
                  <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="paused" defaultChecked={importData.target.paused && !!importData.target.zip} /> Pause the weekly run</label>
                  <button className={btn}>Save target</button>
                </form>
              )}
              {importData.batches.length === 0 ? <p className="mt-3 text-sm text-muted">No imports yet. The first weekly run will show here.</p> : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="text-left text-muted"><tr><th className="py-1 pr-3">Run</th><th className="py-1 pr-3">Received</th><th className="py-1 pr-3">Added</th><th className="py-1 pr-3">Already on file</th><th className="py-1 pr-3">Do not contact</th><th className="py-1">Not verified</th></tr></thead>
                    <tbody>
                      {importData.batches.map((b) => (
                        <tr key={b.id} className="border-t border-line"><td className="py-1 pr-3">{dateLabel(b.created_at)}{b.target_zip ? ` · ${b.target_zip}${b.target_trade ? ` ${b.target_trade}` : ""}` : b.label ? ` · ${b.label}` : ""}</td><td className="py-1 pr-3">{b.received}</td><td className="py-1 pr-3 font-semibold">{b.added}</td><td className="py-1 pr-3">{b.duplicates}</td><td className="py-1 pr-3">{b.suppressed}</td><td className="py-1">{b.invalid + (b.unverified ?? 0)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          <Card className="p-5">
            <h2 className="text-lg font-bold">Add leads</h2>
            <p className="mt-1 text-sm text-ink-soft">Paste one business per line: company, contact, email, phone, website, city, state, ZIP, trades (separate trades with ;). Businesses already on file (same website, phone, or name + ZIP) are skipped.</p>
            <form action={importLeads} className="mt-3 grid gap-3">
              <textarea name="rows" required rows={4} className={`${input} py-2 font-mono`} placeholder="Summit Roofing, Dana Lee, dana@summitroofing.com, 612-555-0100, summitroofing.com, Minneapolis, MN, 55401, roofing;siding" />
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">Assign to<select name="rep" className={input}><option value="">Nobody yet</option>{activeReps.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select></label>
                <button className={btn}>Add leads</button>
              </div>
            </form>
          </Card>
          <nav aria-label="Filter by rep" className="flex flex-wrap gap-1 text-sm">
            {[["", "Everyone"], ["none", "Unassigned"], ...activeReps.map((r) => [r.id, r.full_name])].map(([id, label]) => (
              <Link key={id} href={`/admin/sales-hub?tab=leads${id ? `&rep=${id}` : ""}`} aria-current={(sp.rep ?? "") === id ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 font-medium ${(sp.rep ?? "") === id ? "bg-ink text-white" : "text-ink-soft hover:bg-paper"}`}>{label}</Link>
            ))}
          </nav>
          <form action={assignLeads}>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b border-line text-left text-muted"><tr><th className="p-3"><span className="sr-only">Select</span></th><th className="p-3">Business</th><th className="p-3">Location</th><th className="p-3">Trades</th><th className="p-3">Stage</th><th className="p-3">Rep</th><th className="p-3">Last activity</th><th className="p-3">Source</th></tr></thead>
                <tbody>
                  {leads.length === 0 && <tr><td colSpan={8} className="p-4 text-ink-soft">No leads yet.</td></tr>}
                  {leads.map((l) => (
                    <tr key={l.id} className="border-b border-line last:border-0">
                      <td className="p-3"><input type="checkbox" name="lead" value={l.id} aria-label={`Select ${l.company_name}`} /></td>
                      <td className="p-3"><p className="font-semibold">{l.company_name}</p>{l.contact_name && <p className="text-xs text-ink-soft">{l.contact_name}{l.business_started ? ` · since ${l.business_started.slice(0, 4)}` : ""}</p>}{l.sales_brief && <p className="mt-1 max-w-xs text-xs text-ink-soft">{l.sales_brief}</p>}{l.do_not_contact && <Badge tone="danger">Do not contact</Badge>}</td>
                      <td className="p-3">{[l.city, l.state].filter(Boolean).join(", ")} {l.zip}</td>
                      <td className="p-3">{l.trades.join(", ") || "—"}</td>
                      <td className="p-3">{STAGE_LABEL[l.stage]}</td>
                      <td className="p-3">{l.rep_name ?? "Unassigned"}</td>
                      <td className="p-3">{dateLabel(l.last_activity_at)}</td>
                      <td className="p-3">{SOURCE_LABEL[l.source] ?? l.source} · {dateLabel(l.discovered_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">Assign selected to<select name="rep" className={input}><option value="">Unassign</option>{activeReps.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select></label>
              <button className={btn}>Assign selected</button>
            </div>
          </form>
        </div>
        )
      )}

      {tab === "customers" && (
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Assign or reassign a customer</h2>
            <p className="mt-1 text-sm text-ink-soft">Links are recorded automatically for new accounts. Use this for a customer a rep brought in another way, or to fix a mix-up. The reason is saved in the audit log; commissions already created stay with the rep who earned them.</p>
            <form action={assignCustomer} className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">Customer account email<input name="email" type="email" required className={input} /></label>
              <label className="text-sm">Rep
                <select name="rep" required className={input}>{activeReps.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select>
              </label>
              <label className="text-sm">Reason<input name="reason" required minLength={3} maxLength={300} className={input} placeholder="e.g. Demo at the Sept trade show" /></label>
              <div className="sm:col-span-3"><button className={btn} disabled={activeReps.length === 0}>Assign</button></div>
            </form>
          </Card>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Customer</th><th className="p-3">Rep</th><th className="p-3">Plan</th><th className="p-3">Attributed</th><th className="p-3">First paid</th><th className="p-3">Monthly value</th><th className="p-3"></th></tr></thead>
              <tbody>
                {h.attributions.length === 0 && <tr><td colSpan={7} className="p-4 text-ink-soft">No attributed customers yet.</td></tr>}
                {h.attributions.map((a) => (
                  <tr key={a.user_id} className="border-b border-line align-top last:border-0">
                    <td className="p-3"><p className="font-semibold">{a.business ?? "—"}</p><p className="text-xs text-muted">{a.email}</p></td>
                    <td className="p-3">{a.rep_name}<p className="text-xs text-muted">{a.source === "manual" ? "Assigned by owner" : "Via link"}</p></td>
                    <td className="p-3">{TIER_LABEL[a.tier] ?? a.tier}{a.sub_status && <p className="text-xs text-muted">{a.sub_status}</p>}</td>
                    <td className="p-3">{dateLabel(a.attributed_at)}</td>
                    <td className="p-3">{dateLabel(a.first_paid_at)}</td>
                    <td className="p-3">{a.basis_cents ? usd(a.basis_cents) : "—"}</td>
                    <td className="p-3">
                      {a.ended_at ? <span className="text-xs text-muted">Ended {dateLabel(a.ended_at)}: {a.ended_reason}</span> : (
                        <details><summary className="cursor-pointer text-sm font-semibold text-brand">End</summary>
                          <form action={endAttribution} className="mt-2 flex flex-col gap-2">
                            <input type="hidden" name="user_id" value={a.user_id} />
                            <input name="reason" required minLength={3} maxLength={300} placeholder="Reason" className={input} />
                            <button className={btnLight}>End attribution</button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "commissions" && (
        <div className="space-y-3">
          <nav aria-label="Filter" className="flex flex-wrap gap-1 text-sm">
            {["all", ...Object.keys(COMMISSION_STATUS)].map((s) => (
              <Link key={s} href={`/admin/sales-hub?tab=commissions${s === "all" ? "" : `&status=${s}`}`} aria-current={(sp.status ?? "all") === s ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 font-medium ${(sp.status ?? "all") === s ? "bg-ink text-white" : "text-ink-soft hover:bg-paper"}`}>{s === "all" ? "All" : COMMISSION_STATUS[s].label}</Link>
            ))}
          </nav>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Month</th><th className="p-3">Rep</th><th className="p-3">Customer</th><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
              <tbody>
                {h.commissions.filter((c) => !sp.status || c.status === sp.status).map((c) => {
                  const st = COMMISSION_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
                  return (
                    <tr key={c.id} className="border-b border-line align-top last:border-0">
                      <td className="p-3">{monthLabel(c.period_month)}</td>
                      <td className="p-3">{c.rep_name}</td>
                      <td className="p-3"><p className="font-semibold">{c.business ?? c.email ?? "—"}</p>{c.stripe_invoice_id && <p className="font-mono text-xs text-muted">{c.stripe_invoice_id}</p>}</td>
                      <td className="p-3">{yearLabel(c.year_no, c.kind)}</td>
                      <td className="p-3">{usd(c.amount_cents)}</td>
                      <td className="p-3"><Badge tone={st.tone}>{st.label}</Badge>{c.reason && <p className="mt-1 text-xs text-muted">{reasonLabel(c.reason)}</p>}</td>
                      <td className="p-3">
                        {!["approved", "paid"].includes(c.status) && (
                          <details><summary className="cursor-pointer text-sm font-semibold text-brand">Adjust</summary>
                            <form action={adjustCommission} className="mt-2 flex w-56 flex-col gap-2">
                              <input type="hidden" name="id" value={c.id} />
                              <select name="status" defaultValue={c.status === "reversed" ? "canceled" : c.status} className={input}>
                                <option value="pending">Pending</option><option value="earned">Earned</option><option value="ineligible">Ineligible</option><option value="canceled">Canceled</option>
                              </select>
                              <input name="amount" inputMode="decimal" placeholder={`Amount (${(Math.abs(c.amount_cents) / 100).toFixed(2)})`} className={input} />
                              <input name="reason" required minLength={3} maxLength={300} placeholder="Reason (audit log)" className={input} />
                              <button className={btnLight}>Save</button>
                            </form>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {h.commissions.length === 0 && <tr><td colSpan={7} className="p-4 text-ink-soft">No commissions yet. They start when a rep&apos;s customer pays.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "statements" && (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="max-w-2xl text-sm text-ink-soft">Month-end runs automatically every night: last month&apos;s pending commissions become earned and land on each rep&apos;s statement. Approve a statement, pay the rep the usual way (outside Built2Bid), then record the payout. A statement can only be paid once.</p>
            <form action={closeMonth}><button className={btnLight}>Run month-end now</button></form>
          </Card>
          {h.statements.length === 0 && <Card className="p-5 text-ink-soft">No statements yet.</Card>}
          {h.statements.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">{s.rep_name} · {monthLabel(s.period_month)}</p>
                  <p className="text-sm text-muted">{plural(s.line_count, "line")} · {usd(s.total_cents)}{s.payout_note ? ` · Pay via: ${s.payout_note}` : ""}</p>
                </div>
                <Badge tone={s.status === "paid" ? "ok" : s.status === "approved" ? "brand" : "accent"}>{s.status === "open" ? "Needs approval" : s.status === "approved" ? "Approved, not paid" : "Paid"}</Badge>
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {h.commissions.filter((c) => c.statement_id === s.id).map((c) => (
                  <li key={c.id} className="flex justify-between gap-3 border-b border-line py-1 last:border-0"><span>{c.business ?? c.email ?? "—"} · {yearLabel(c.year_no, c.kind)}{["reversed", "canceled", "ineligible"].includes(c.status) ? ` (${COMMISSION_STATUS[c.status].label.toLowerCase()})` : ""}</span><span className="font-mono">{usd(c.amount_cents)}</span></li>
                ))}
              </ul>
              {s.status === "open" && <form action={approveStatement} className="mt-3"><input type="hidden" name="id" value={s.id} /><button className={btn} disabled={!h.settings.policy_confirmed_at}>Approve {usd(s.total_cents)}</button></form>}
              {s.status === "approved" && (
                <form action={recordPayout} className="mt-3 grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="id" value={s.id} />
                  <label className="text-sm">Paid on<input type="date" name="paid_on" required defaultValue={new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })} className={input} /></label>
                  <label className="text-sm">Method<select name="method" className={input}><option value="ach">Bank transfer</option><option value="payroll">Payroll</option><option value="check">Check</option><option value="paypal">PayPal</option><option value="other">Other</option></select></label>
                  <label className="text-sm">Reference<input name="reference" maxLength={200} placeholder="Check # or transfer id" className={input} /></label>
                  <div className="flex items-end"><button className={btn}>Record payout</button></div>
                </form>
              )}
              {s.payout && <p className="mt-3 text-sm text-muted">Paid {dateLabel(s.payout.paid_on)} · {usd(s.payout.amount_cents)} · {METHOD_LABEL[s.payout.method] ?? s.payout.method}{s.payout.reference ? ` · ${s.payout.reference}` : ""}</p>}
            </Card>
          ))}
        </div>
      )}

      {tab === "policy" && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Commission policy</h2>
          <p className="mt-1 text-sm text-ink-soft">One month of the customer&apos;s subscription value, before tax, at the sale month and each anniversary month. These settings are the written rules the ledger follows; every change is audit logged. {h.settings.policy_confirmed_at ? `Confirmed ${dateLabel(h.settings.policy_confirmed_at)}.` : "Not confirmed yet."}</p>
          <form action={savePolicy} className="mt-4 grid gap-4">
            {(Object.keys(POLICY) as (keyof typeof POLICY)[]).map((k) => (
              <fieldset key={k} className="space-y-1">
                <legend className="text-sm font-semibold">{k === "annual_basis" ? "Annual plans" : k === "refund_policy" ? "Refunds" : "What counts as the monthly value"}</legend>
                {Object.entries(POLICY[k]).map(([v, label]) => (
                  <label key={v} className="flex items-start gap-2 text-sm"><input type="radio" name={k} value={v} defaultChecked={h.settings[k] === v} className="mt-1" /> {label}</label>
                ))}
              </fieldset>
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Years of commission<input type="number" name="commission_years" min={1} max={10} defaultValue={h.settings.commission_years} className={input} /></label>
              <label className="text-sm">Link counts for accounts created within (days of the visit)<input type="number" name="attribution_window_days" min={1} max={365} defaultValue={h.settings.attribution_window_days} className={input} /></label>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" defaultChecked={false} /> I confirm these are the commission rules (needed before statements can be approved).</label>
            <div><button className={btn}>Save policy</button></div>
          </form>
          <p className="mt-4 text-xs text-muted">Months close in Central time. Discounts and coupons aren&apos;t subtracted automatically; adjust a line before approving if needed. Refunds are tracked once the Stripe webhook includes the charge.refunded event.</p>
        </Card>
      )}
    </div>
  );
}
