import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { RANGES, STAGES, STAGE_LABELS, isRange, money, rangeStart, type RangeKey, type Stage } from "@/lib/enterprise/pipeline";
import { Card, Notice } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { ApprovalToggle } from "@/components/company/approval-toggle";

export const metadata: Metadata = { title: "Company Overview", robots: { index: false } };

type MemberStat = { userId: string; name: string; status: string | null; bids: number; sent: number; won: number; lost: number; wonValue: number; avgBid: number | null; winRate: number | null; avgMargin: number | null };
type Summary = {
  bids: number; sent: number; won: number; lost: number; awaitingReview: number; winRate: number | null; wonValue: number; openValue: number;
  avgBid: number | null; avgMargin: number | null; stages: Record<Stage, { count: number; value: number }>; members: MemberStat[]; requireApproval: boolean;
};

const BAR: Record<Stage, string> = {
  draft: "bg-line-strong", ready_for_review: "bg-warn", approved: "bg-brand", sent: "bg-accent", pending: "bg-accent/70", won: "bg-ok", lost: "bg-danger",
};

export default async function CompanyOverviewPage({ searchParams }: PageProps<"/company">) {
  const sp = await searchParams;
  const range: RangeKey = isRange(sp.range) ? sp.range : "90d";
  const team = typeof sp.team === "string" && /^[0-9a-f-]{36}$/i.test(sp.team) ? sp.team : null;
  const supabase = await createClient();
  const company = await loadMyCompany(supabase);
  if (!company) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-extrabold">Company Overview</h1>
        <Notice title="No company account">The Command Center is part of Enterprise. <Link href="/pricing#enterprise" className="underline">See Enterprise</Link>.</Notice>
      </div>
    );
  }
  if (!can(company, "view_analytics")) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-extrabold">Company Overview</h1>
        <Notice title="Analytics aren't part of your access">Ask your company owner for the &quot;View analytics&quot; permission. Your bids are on <Link href="/company/pipeline" className="underline">Bids & Pipeline</Link>.</Notice>
      </div>
    );
  }
  const [{ data, error }, { data: teams }] = await Promise.all([
    supabase.rpc("company_pipeline_summary", { p_from: rangeStart(range), p_to: null, p_team: team }),
    supabase.rpc("company_teams_overview"),
  ]);
  const s = data as Summary | null;
  const teamList = (teams ?? []) as { id: string; name: string }[];
  const maxStage = Math.max(1, ...STAGES.map((k) => s?.stages?.[k]?.count ?? 0));
  const showMargin = can(company, "view_margin");
  const link = (over: { range?: string; team?: string | null }) => {
    const p = new URLSearchParams();
    const r = over.range ?? range; const t = over.team === undefined ? team : over.team;
    if (r !== "90d") p.set("range", r);
    if (t) p.set("team", t);
    const q = p.toString();
    return q ? `?${q}` : "/company";
  };
  const pipeHref = (stage?: Stage) => `/company/pipeline?${new URLSearchParams({ range, ...(team ? { team } : {}), ...(stage ? { stage } : {}) })}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold">Company Overview</h1>
          <p className="text-ink-soft">{company.name}{team && teamList.find((t) => t.id === team) ? ` · ${teamList.find((t) => t.id === team)!.name}` : ""}</p>
        </div>
        <ButtonLink href={pipeHref()} variant="secondary">Open Bids & Pipeline</ButtonLink>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Date range">
        {Object.entries(RANGES).map(([k, v]) => <Link key={k} href={link({ range: k })} aria-current={k === range ? "true" : undefined} className={`rounded-full border px-3 py-1 text-sm ${k === range ? "border-brand bg-brand-tint font-semibold" : "border-line"}`}>{v}</Link>)}
        {teamList.length > 0 && <span className="mx-1 hidden self-center text-line-strong sm:inline">|</span>}
        {teamList.length > 0 && <Link href={link({ team: null })} className={`rounded-full border px-3 py-1 text-sm ${!team ? "border-brand bg-brand-tint font-semibold" : "border-line"}`}>All teams</Link>}
        {teamList.map((t) => <Link key={t.id} href={link({ team: t.id })} className={`rounded-full border px-3 py-1 text-sm ${team === t.id ? "border-brand bg-brand-tint font-semibold" : "border-line"}`}>{t.name}</Link>)}
      </div>

      {error || !s ? <Notice tone="danger">The overview couldn&apos;t be loaded. Please refresh.</Notice> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpis">
            <Kpi label="Bids created" value={String(s.bids)} sub={`${s.sent} sent to customers`} />
            <Kpi label="Win rate" value={s.winRate === null ? "—" : `${s.winRate}%`} sub={`${s.won} won · ${s.lost} lost`} />
            <Kpi label="Won value" value={money(s.wonValue)} sub={`${money(s.openValue)} open (sent + pending)`} />
            <Kpi label={showMargin ? "Avg margin" : "Avg bid"} value={showMargin ? (s.avgMargin === null ? "—" : `${s.avgMargin}%`) : money(s.avgBid)} sub={showMargin ? `Avg bid ${money(s.avgBid)}` : "latest finalized version"} />
          </div>

          {s.awaitingReview > 0 && (
            <Notice tone="warn" title={`${s.awaitingReview} bid${s.awaitingReview === 1 ? "" : "s"} waiting for review`}>
              <Link href={pipeHref("ready_for_review")} className="underline">Review them now</Link>
            </Notice>
          )}

          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">Pipeline</h2>
            <ul className="mt-3 space-y-2" data-testid="stage-bars">{STAGES.map((k) => {
              const st = s.stages[k] ?? { count: 0, value: 0 };
              return (
                <li key={k}>
                  <Link href={pipeHref(k)} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md py-1 text-sm hover:bg-paper sm:grid-cols-[9rem_minmax(0,1fr)_9rem]">
                    <span className="font-semibold">{STAGE_LABELS[k]}</span>
                    <span className="h-3 overflow-hidden rounded-full bg-paper"><span className={`block h-full rounded-full ${BAR[k]}`} style={{ width: `${(st.count / maxStage) * 100}%` }} /></span>
                    <span className="text-right tabular-nums"><b>{st.count}</b> <span className="text-ink-soft">· {money(st.value)}</span></span>
                  </Link>
                </li>
              );
            })}</ul>
          </Card>

          <Card className="p-0">
            <h2 className="border-b border-line px-4 py-3 font-display text-lg font-bold">Team performance</h2>
            {s.members.length === 0 ? <p className="px-4 py-6 text-center text-ink-soft">No bids in this period yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm" data-testid="team-table">
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
                    <th className="px-4 py-2 font-semibold">Estimator</th><th className="px-2 py-2 text-right font-semibold">Bids</th><th className="px-2 py-2 text-right font-semibold">Sent</th>
                    <th className="px-2 py-2 text-right font-semibold">Won</th><th className="px-2 py-2 text-right font-semibold">Win rate</th><th className="px-2 py-2 text-right font-semibold">Won value</th>
                    <th className="px-2 py-2 text-right font-semibold">Avg bid</th>{showMargin && <th className="px-4 py-2 text-right font-semibold">Avg margin</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-line">{s.members.map((m) => (
                    <tr key={m.userId}>
                      <td className="px-4 py-2"><Link href={`/company/pipeline?${new URLSearchParams({ range, user: m.userId })}`} className="font-semibold hover:text-brand">{m.name}</Link>{m.status === "deactivated" && <span className="text-xs text-ink-soft"> (deactivated)</span>}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{m.bids}</td><td className="px-2 py-2 text-right tabular-nums">{m.sent}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{m.won}</td><td className="px-2 py-2 text-right tabular-nums">{m.winRate === null ? "—" : `${m.winRate}%`}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(m.wonValue)}</td><td className="px-2 py-2 text-right tabular-nums">{money(m.avgBid)}</td>
                      {showMargin && <td className="px-4 py-2 text-right tabular-nums">{m.avgMargin === null ? "—" : `${m.avgMargin}%`}</td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>

          {company.isOwner && <Card className="p-4"><h2 className="mb-2 font-display text-lg font-bold">Approval rule</h2><ApprovalToggle required={s.requireApproval} /></Card>}
          <p className="text-xs text-ink-soft">Win rate counts bids marked Won or Lost. Values use each bid&apos;s latest finalized version; drafts without one count as bids but add no value.</p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="min-w-0 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="truncate text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>
    </Card>
  );
}
