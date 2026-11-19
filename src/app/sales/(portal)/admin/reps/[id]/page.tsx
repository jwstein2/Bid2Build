import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesAdmin } from "@/lib/sales/server";
import { detailSummary, RANGES, rangeSince, type RepDetail } from "@/lib/sales/caps";
import { STAGE_LABEL } from "@/lib/sales/crm";
import { dateLabel, monthLabel, usd } from "@/lib/sales/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rep activity" };

const STAGES = ["new", "contacted", "engaged", "demo", "trial", "paying", "lost"] as const;

/**
 * "Viewing Sarah's Sales Activity". Read through an admin API (admin_sales_rep_detail), never by signing
 * in as the rep. Each view is written to the audit log. Nothing here can act as the rep.
 */
export default async function RepActivity({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> }) {
  const { user, db, has } = await requireSalesAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const range = rangeSince((await searchParams).range);
  const { data, error } = await db.rpc("admin_sales_rep_detail", { p_caller: user.id, p_rep: id, p_since: range.since.toISOString(), p_until: range.until.toISOString() });
  if (error?.message?.includes("not_found")) notFound();
  if (error || !data) return <Notice tone="warn">Run <code className="break-all">supabase/migrations/20270113001000_sales_v83_roles.sql</code> in the Supabase SQL Editor to see rep activity.</Notice>;
  const d = data as RepDetail;
  const first = d.rep.full_name.split(" ")[0];
  const maxWeek = Math.max(1, ...d.weeks.map((w) => w.contacted));
  const chip = (on: boolean) => `rounded-md px-2.5 py-1.5 font-medium ${on ? "bg-ink text-white" : "text-ink-soft hover:bg-white"}`;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/sales/admin?tab=analytics" className="text-sm font-semibold text-brand underline">← Team analytics</Link>
        <h1 className="mt-2 text-3xl font-extrabold">Viewing {first}&apos;s Sales Activity</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {d.rep.full_name} · {d.rep.email} · {d.rep.status === "active" ? <Badge tone="ok">Active</Badge> : <Badge tone="warn">{d.rep.status}</Badge>}
          {d.rep.is_admin_rep && <> · <Badge tone="brand">Also an administrator</Badge></>}
          {d.rep.activated_at && <> · joined {dateLabel(d.rep.activated_at)}</>}
        </p>
        <p className="mt-1 text-xs text-muted">Read-only admin view. You aren&apos;t signed in as {first}, and this visit is recorded in the audit log.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Time range" className="flex flex-wrap gap-1 text-sm">
          {Object.entries(RANGES).map(([k, v]) => <Link key={k} href={`/sales/admin/reps/${id}?range=${k}`} aria-current={range.key === k ? "page" : undefined} className={chip(range.key === k)}>{v.label}</Link>)}
        </nav>
        {has("export_reports") && <a href={`/sales/admin/reps/${id}/export?range=${range.key}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold">Export CSV</a>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        {detailSummary(d).map(([k, v]) => <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-xl font-extrabold">{v}</p></Card>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-bold">Contacted leads per week</h2>
          <p className="text-xs text-muted">Last 12 weeks · distinct leads reached by call, email, text or meeting</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {d.weeks.map((w) => (
              <li key={w.week} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2">
                <span className="text-xs text-muted">{dateLabel(w.week)}</span>
                <span className="h-3 rounded bg-paper"><span className="block h-3 rounded bg-brand" style={{ width: `${(w.contacted / maxWeek) * 100}%` }} /></span>
                <span className="w-28 text-right text-xs">{w.contacted} · {w.calls} calls · {w.closed} closed</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-bold">Pipeline</h2>
          <p className="text-xs text-muted">Leads assigned to {first} by stage, right now</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {STAGES.map((s) => <li key={s} className="flex justify-between border-b border-line py-1 last:border-0"><span>{STAGE_LABEL[s] ?? s}</span><span className="font-semibold">{d.stages[s] ?? 0}</span></li>)}
          </ul>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <h2 className="p-4 pb-0 text-lg font-bold">Leads</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Company</th><th className="p-3">Stage</th><th className="p-3">Last activity</th><th className="p-3">Next step</th></tr></thead>
          <tbody>
            {d.leads.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="p-3 font-semibold">{l.company_name}{l.do_not_contact && <> <Badge tone="danger">Do not contact</Badge></>}</td>
                <td className="p-3">{STAGE_LABEL[l.stage as keyof typeof STAGE_LABEL] ?? l.stage}</td>
                <td className="p-3">{l.last_activity_at ? dateLabel(l.last_activity_at) : "—"}</td>
                <td className="p-3">{l.next_action_at ? <span className={new Date(l.next_action_at) < new Date() ? "font-semibold text-danger" : ""}>{dateLabel(l.next_action_at)}</span> : "—"}</td>
              </tr>
            ))}
            {d.leads.length === 0 && <tr><td colSpan={4} className="p-4 text-ink-soft">No leads assigned.</td></tr>}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <h2 className="p-4 pb-0 text-lg font-bold">Customers</h2>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Business</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">First paid</th></tr></thead>
            <tbody>
              {d.customers.map((c, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="p-3">{c.company ?? "—"}</td><td className="p-3">{c.plan ?? "—"}</td>
                  <td className="p-3">{c.ended_at ? "Ended" : c.sub_status ?? "—"}</td><td className="p-3">{c.first_paid_at ? dateLabel(c.first_paid_at) : "—"}</td>
                </tr>
              ))}
              {d.customers.length === 0 && <tr><td colSpan={4} className="p-4 text-ink-soft">No customers yet.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-bold">Statements</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {d.statements.map((s) => <li key={s.period_month} className="flex justify-between border-b border-line py-1 last:border-0"><span>{monthLabel(s.period_month)} · {s.status === "open" ? "Needs approval" : s.status === "approved" ? "Approved, not paid" : "Paid"}</span><span className="font-mono">{usd(s.total_cents)}</span></li>)}
            {d.statements.length === 0 && <li className="text-ink-soft">No statements yet.</li>}
          </ul>
          <Link href="/sales/admin?tab=statements" className="mt-3 inline-block text-sm font-semibold text-brand underline">Statements & payouts</Link>
        </Card>
      </div>
    </div>
  );
}
