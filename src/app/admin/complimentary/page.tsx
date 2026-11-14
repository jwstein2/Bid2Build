import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { COMP_PLANS, STATE_FILTERS, STATE_LABELS, type CompMetrics, type CompRow, type CompState } from "@/lib/comp/grants";
import { GrantForm } from "./grant-form";
import { GrantsTable } from "./grants-table";

export const dynamic = "force-dynamic";

interface Filters { q?: string; plan?: string; state?: string; from?: string; to?: string }

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

export default async function ComplimentaryAccess({ searchParams }: { searchParams: Promise<Filters> }) {
  const { user, db } = await requireAdmin();
  const sp = await searchParams;
  const filters = {
    q: (sp.q ?? "").slice(0, 100),
    plan: COMP_PLANS.includes(sp.plan as never) ? sp.plan! : "",
    state: STATE_FILTERS.includes(sp.state as never) ? sp.state! : "",
    from: isDate(sp.from) ? sp.from! : "",
    to: isDate(sp.to) ? sp.to! : "",
  };
  const { data, error } = await db.rpc("admin_comp_list", { p_caller: user.id, p_filters: filters });
  if (error || !data) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Complimentary Access</h1>
        <p className="text-ink-soft">The complimentary access tables are not installed yet. Run <code>supabase/migrations/20261114004000_complimentary_access.sql</code> in the Supabase SQL Editor, then reload.</p>
      </div>
    );
  }
  const { rows, metrics } = data as { rows: CompRow[]; metrics: CompMetrics };
  const filtered = Boolean(filters.q || filters.plan || filters.state || filters.from || filters.to);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">Complimentary Access</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Give a prospect or customer free, time-limited Unlimited or Enterprise access. Grants never create Stripe customers,
          subscriptions or charges, and never change a paid plan. Access ends automatically on the expiry date; their bids and
          account stay. Every action is recorded in the audit log.
        </p>
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat k="Active" v={metrics.active} sub={`${metrics.paused} paused`} />
        <Stat k="Pending invitations" v={metrics.pending} sub={`${metrics.invite_expired} invitation${metrics.invite_expired === 1 ? "" : "s"} expired`} />
        <Stat k="Expiring within 7 days" v={metrics.expiring_soon} />
        <Stat k="Expired" v={metrics.expired} sub={`${metrics.revoked} revoked`} />
        <Stat k="Unlimited grants" v={metrics.unlimited} />
        <Stat k="Enterprise grants" v={metrics.enterprise} />
        <Stat k="Converted to paid" v={metrics.converted} sub="Subscribed after a grant (excludes people who were already paying)" />
        <Stat k="All grants" v={metrics.total} sub={filters.plan || filters.from || filters.to ? "Matching plan/date filters" : undefined} />
      </section>

      <GrantForm />

      <section aria-labelledby="grants-heading" className="space-y-3">
        <h2 id="grants-heading" className="font-display text-xl font-bold">Grants</h2>
        <form method="get" className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Search</span>
            <input name="q" defaultValue={filters.q} placeholder="Email or company" className="w-full rounded-md border border-line-strong px-2.5 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Plan</span>
            <select name="plan" defaultValue={filters.plan} className="w-full rounded-md border border-line-strong px-2.5 py-2">
              <option value="">All plans</option><option value="unlimited">Unlimited</option><option value="enterprise">Enterprise</option>
            </select></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Status</span>
            <select name="state" defaultValue={filters.state} className="w-full rounded-md border border-line-strong px-2.5 py-2">
              <option value="">All statuses</option>
              {STATE_FILTERS.map((s) => <option key={s} value={s}>{s === "expiring_soon" ? "Expiring within 7 days" : STATE_LABELS[s as CompState]}</option>)}
            </select></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Granted from</span>
            <input type="date" name="from" defaultValue={filters.from} className="w-full rounded-md border border-line-strong px-2.5 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Granted to</span>
            <input type="date" name="to" defaultValue={filters.to} className="w-full rounded-md border border-line-strong px-2.5 py-2" /></label>
          <div className="flex items-end gap-2">
            <button className="min-h-10 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white">Apply</button>
            {filtered && <Link href="/admin/complimentary" className="min-h-10 rounded-md px-2 py-2 text-sm font-medium text-ink-soft underline">Clear</Link>}
          </div>
        </form>
        <GrantsTable rows={rows} filtered={filtered} />
        {rows.length >= 500 && <p className="text-xs text-muted">Showing the newest 500 grants. Narrow the filters to see older ones.</p>}
      </section>
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: number; sub?: string }) {
  return <Card className="p-4"><p className="text-sm text-ink-soft">{k}</p><p className="tabular mt-1 text-3xl font-extrabold">{v.toLocaleString("en-US")}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</Card>;
}
