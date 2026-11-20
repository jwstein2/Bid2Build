import Link from "next/link";
import { MetricCard } from "@/components/ui/metric-card";
import { requireAdmin } from "@/lib/admin/server";
import { COMP_PLANS, STATE_FILTERS, STATE_LABELS, type CompMetrics, type CompRow, type CompState } from "@/lib/comp/grants";
import { GrantForm } from "./grant-form";
import { GrantsTable } from "./grants-table";
import { Badge } from "@/components/ui/misc";
import { ACTIVATION_LABELS, ACTIVATION_TONES, activationFor, followUpMailto, type ActivationRow, type FirstEstimate } from "@/lib/comp/activation";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

interface Filters { q?: string; plan?: string; state?: string; from?: string; to?: string; email?: string }

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

export default async function ComplimentaryAccess({ searchParams }: { searchParams: Promise<Filters> }) {
  const { user, db } = await requireAdmin();
  const sp = await searchParams;
  const filters = {
    q: (sp.q ?? "").slice(0, 100),
    plan: COMP_PLANS.includes(sp.plan as never) ? sp.plan! : "",
    state: STATE_FILTERS.includes(sp.state as never) ? sp.state! : "",
    /** "converted" is a drilldown on the returned rows, not a stored state: never sent to the database. */
    from: isDate(sp.from) ? sp.from! : "",
    to: isDate(sp.to) ? sp.to! : "",
  };
  const converted = sp.state === "converted";
  const followOnly = sp.state === "follow_up";
  const { data, error } = await db.rpc("admin_comp_list", { p_caller: user.id, p_filters: filters });
  if (error || !data) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Complimentary Access</h1>
        <p className="text-ink-soft">The complimentary access tables are not installed yet. Run <code className="break-all">supabase/migrations/20261114004000_complimentary_access.sql</code> in the Supabase SQL Editor, then reload.</p>
      </div>
    );
  }
  const { rows: allRows, metrics } = data as { rows: CompRow[]; metrics: CompMetrics };
  // Activation (Phase 2): first bid started per recipient, in one query (service role, admin only).
  const userIds = [...new Set(allRows.map((r) => r.user_id).filter((x): x is string => Boolean(x)))];
  const firsts = new Map<string, FirstEstimate>();
  if (userIds.length) {
    const { data: ests } = await db.from("estimates").select("user_id, created_at").in("user_id", userIds.slice(0, 500)).order("created_at", { ascending: true }).limit(5000);
    for (const e of (ests ?? []) as { user_id: string; created_at: string }[]) {
      const f = firsts.get(e.user_id);
      if (f) f.count += 1; else firsts.set(e.user_id, { at: e.created_at, count: 1 });
    }
  }
  const act = new Map<string, ActivationRow>(allRows.map((r) => [r.id, activationFor(r, r.user_id ? firsts.get(r.user_id) ?? null : null)]));
  const followCount = allRows.filter((r) => act.get(r.id)!.followUp).length;
  const rows = converted ? allRows.filter((r) => r.converted) : followOnly ? allRows.filter((r) => act.get(r.id)!.followUp) : allRows;
  const summaryRows = allRows.filter((r) => r.state !== "revoked" && r.state !== "expired").sort((a, b) => Number(act.get(b.id)!.followUp) - Number(act.get(a.id)!.followUp));
  const filtered = Boolean(filters.q || filters.plan || filters.state || filters.from || filters.to || converted || followOnly);
  // KPI drilldowns keep the plan/date filters the metrics were computed with, and swap the status.
  const keep = { ...(filters.plan ? { plan: filters.plan } : {}), ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) };
  const drill = (patch: Record<string, string>) => { const q = new URLSearchParams({ ...keep, ...patch }).toString(); return `/admin/complimentary${q ? `?${q}` : ""}#grants`; };
  const current = converted ? "converted" : followOnly ? "follow_up" : filters.state || (filters.plan && !filters.q ? `plan:${filters.plan}` : "");
  const EMPTY: Record<string, string> = {
    active: "No active complimentary grants.", pending: "No pending invitations.", expiring_soon: "No grants expire within 7 days.", expired: "No expired grants.",
    converted: "No one has converted to paid after a grant yet.", follow_up: "No one needs a follow-up right now.", "plan:unlimited": "No Individual Unlimited grants.", "plan:enterprise": "No Team grants.",
    invite_expired: "No expired invitations.", paused: "No paused grants.", revoked: "No revoked grants.",
  };
  const emptyText = filters.q || filters.from || filters.to ? undefined : EMPTY[current];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm"><Link href="/admin/customers" className="text-ink-soft underline">Customers</Link> <span className="text-muted">/</span></p>
        <h1 className="text-3xl font-extrabold">Complimentary Access</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Give a prospect or customer free, time-limited Individual Unlimited or Team access. Grants never create Stripe customers,
          subscriptions or charges, and never change a paid plan. Access ends automatically on the expiry date; their bids and
          account stay. Every action is recorded in the audit log.
        </p>
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat k="Active" v={metrics.active} sub={`${metrics.paused} paused`} href={drill({ state: "active" })} action="View active grants" on={current === "active"} />
        <Stat k="Pending invitations" v={metrics.pending} sub={`${metrics.invite_expired} invitation${metrics.invite_expired === 1 ? "" : "s"} expired`} href={drill({ state: "pending" })} action="View pending invitations" on={current === "pending"} />
        <Stat k="Expiring within 7 days" v={metrics.expiring_soon} href={drill({ state: "expiring_soon" })} action="View expiring grants" on={current === "expiring_soon"} warn={metrics.expiring_soon > 0} />
        <Stat k="Expired" v={metrics.expired} sub={`${metrics.revoked} revoked`} href={drill({ state: "expired" })} action="View expired grants" on={current === "expired"} />
        <Stat k="Individual Unlimited grants" v={metrics.unlimited} href={drill({ plan: "unlimited" })} action="Filter: Individual Unlimited" on={current === "plan:unlimited"} />
        <Stat k="Team grants" v={metrics.enterprise} href={drill({ plan: "enterprise" })} action="Filter: Team" on={current === "plan:enterprise"} />
        <Stat k="Converted to paid" v={metrics.converted} sub="Subscribed after a grant (excludes people who were already paying)" href={drill({ state: "converted" })} action="View converted customers" on={current === "converted"} />
        <Stat k="Needs follow-up" v={followCount} sub="Not accepted, no bid started, inactive, or ending soon" href={drill({ state: "follow_up" })} action="View who needs a follow-up" on={current === "follow_up"} warn={followCount > 0} />
        <Stat k="All grants" v={metrics.total} sub={filters.plan || filters.from || filters.to ? "Matching plan/date filters" : undefined} href={drill({})} action="Open the grants directory" on={!filtered} />
      </section>

      <section id="activation" aria-labelledby="activation-heading" className="scroll-mt-24 space-y-3" data-testid="comp-activation">
        <div>
          <h2 id="activation-heading" className="font-display text-xl font-bold">Activation summary</h2>
          <p className="text-sm text-ink-soft">Who has actually used their access, without leaving this page. Follow-ups open your own email app with a short note; nothing is sent automatically.</p>
        </div>
        {summaryRows.length ? (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-paper text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Access</th><th className="px-3 py-2">Days left</th><th className="px-3 py-2">Invite</th><th className="px-3 py-2">Last activity</th><th className="px-3 py-2">First bid</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Follow-up</th></tr>
              </thead>
              <tbody>
                {summaryRows.slice(0, 200).map((r) => {
                  const a = act.get(r.id)!;
                  return (
                    <tr key={r.id} className={`border-t border-line ${a.followUp ? "bg-warn-tint/40" : ""}`} data-follow-up={a.followUp ? "true" : "false"}>
                      <td className="px-3 py-2"><span className="block font-semibold">{r.account_name ?? r.email}</span>{r.account_name && <span className="block text-xs text-muted">{r.email}</span>}</td>
                      <td className="px-3 py-2">{r.plan === "enterprise" ? "Team" : "Individual Unlimited"} · {r.paid_now ? "Paid" : "Complimentary"}</td>
                      <td className="px-3 py-2 tabular-nums">{a.daysLeft ?? "—"}</td>
                      <td className="px-3 py-2">{a.inviteStatus === "accepted" ? "Accepted" : a.inviteStatus === "expired" ? <Badge tone="danger">Expired</Badge> : <Badge tone="warn">Pending</Badge>}</td>
                      <td className="px-3 py-2">{fmtDay(r.last_activity_at)}</td>
                      <td className="px-3 py-2">{a.firstEstimate ? <>Yes · {fmtDay(a.firstEstimate.at)}<span className="block text-xs text-muted">{a.firstEstimate.count} bid{a.firstEstimate.count === 1 ? "" : "s"}</span></> : <span className="text-muted">No</span>}</td>
                      <td className="px-3 py-2"><Badge tone={ACTIVATION_TONES[a.activation]}>{ACTIVATION_LABELS[a.activation]}</Badge></td>
                      <td className="px-3 py-2">{a.followUp ? <span className="block"><span className="block text-xs font-semibold text-warn">{a.reason}</span><a href={followUpMailto(r, a, site.url)} className="text-xs font-semibold text-accent-ink underline">Email them</a>{r.user_id && <> · <Link href={`/admin/customers/${r.user_id}`} className="text-xs font-semibold text-accent-ink underline">Account</Link></>}</span> : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-xl border border-line bg-surface p-4 text-center text-sm text-muted">No current grants.</p>}
      </section>

      <div id="grant" className="scroll-mt-24"><GrantForm defaultEmail={/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(sp.email ?? "") ? sp.email!.trim().toLowerCase() : ""} /></div>

      <section id="grants" aria-labelledby="grants-heading" className="scroll-mt-24 space-y-3">
        <h2 id="grants-heading" className="font-display text-xl font-bold">Grants</h2>
        <form key={`${filters.q}|${filters.plan}|${filters.state}|${converted}|${filters.from}|${filters.to}`} method="get" className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Search</span>
            <input name="q" defaultValue={filters.q} placeholder="Email or company" className="w-full rounded-md border border-line-strong px-2.5 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Plan</span>
            <select name="plan" defaultValue={filters.plan} className="w-full rounded-md border border-line-strong px-2.5 py-2">
              <option value="">All plans</option><option value="unlimited">Individual Unlimited</option><option value="enterprise">Team</option>
            </select></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Status</span>
            <select name="state" defaultValue={converted ? "converted" : filters.state} className="w-full rounded-md border border-line-strong px-2.5 py-2">
              <option value="">All statuses</option>
              {STATE_FILTERS.map((s) => <option key={s} value={s}>{s === "expiring_soon" ? "Expiring within 7 days" : STATE_LABELS[s as CompState]}</option>)}
              <option value="converted">Converted to paid</option>
            </select></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Granted from</span>
            <input type="date" name="from" defaultValue={filters.from} className="w-full rounded-md border border-line-strong px-2.5 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Granted to</span>
            <input type="date" name="to" defaultValue={filters.to} className="w-full rounded-md border border-line-strong px-2.5 py-2" /></label>
          <div className="flex items-end gap-2">
            <button className="min-h-10 rounded-md bg-[var(--cc-green)] px-3 py-2 text-sm font-bold text-[#03140c]">Apply</button>
            {filtered && <Link href="/admin/complimentary" className="min-h-10 rounded-md px-2 py-2 text-sm font-medium text-ink-soft underline">Clear</Link>}
          </div>
        </form>
        <GrantsTable rows={rows} filtered={filtered} emptyText={emptyText} />
        {rows.length >= 500 && <p className="text-xs text-muted">Showing the newest 500 grants. Narrow the filters to see older ones.</p>}
      </section>
    </div>
  );
}

function fmtDay(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

function Stat({ k, v, sub, href, action, on, warn }: { k: string; v: number; sub?: string; href: string; action: string; on?: boolean; warn?: boolean }) {
  return (
    <MetricCard title={k} value={v.toLocaleString("en-US")} sub={sub} href={href} action={action} empty={v === 0} tone={warn ? "warn" : "default"} testId="comp-kpi"
      className={on ? "border-[var(--cc-green)] shadow-[inset_0_0_0_1px_var(--cc-green)]" : undefined}
      status={on ? <span className="rounded-full bg-ok-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ok">Showing</span> : undefined} />
  );
}
