import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { RANGES, STAGES, STAGE_LABELS, STAGE_TONES, money, parseFilters, rpcArgs, type PipelineRow } from "@/lib/enterprise/pipeline";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { StageControl } from "@/components/company/stage-control";

export const metadata: Metadata = { title: "Bids & Pipeline", robots: { index: false } };

const PAGE = 50;

export default async function PipelinePage({ searchParams }: PageProps<"/company/pipeline">) {
  const sp = await searchParams;
  const supabase = await createClient();
  const company = await loadMyCompany(supabase);
  if (!company) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-extrabold">Bids & Pipeline</h1>
        <Notice title="No company account">Bids & Pipeline is part of Enterprise.</Notice>
      </div>
    );
  }
  const f = parseFilters(sp);
  const page = Math.max(1, Math.min(1000, Number(typeof sp.page === "string" ? sp.page : 1) || 1));
  const [{ data, error }, { data: roster }, { data: teams }] = await Promise.all([
    supabase.rpc("company_pipeline_bids", rpcArgs(f, PAGE, (page - 1) * PAGE)),
    supabase.rpc("company_roster"),
    supabase.rpc("company_teams_overview"),
  ]);
  const rows = (data ?? []) as PipelineRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  const showMargin = can(company, "view_margin");
  const people = ((roster ?? []) as { user_id: string; display_name: string | null; email: string | null }[]);
  const teamList = ((teams ?? []) as { id: string; name: string }[]);
  const wide = can(company, "view_company_bids") || can(company, "view_team_bids");
  const qs = (over: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | number | null> = { stage: f.stage, user: f.user, team: f.team, q: f.q, range: f.range, page, ...over };
    for (const [k, v] of Object.entries(base)) if (v !== null && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    return p.toString();
  };
  const select = "mt-1 h-11 w-full rounded-lg border border-line bg-surface px-2 text-base";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold">Bids & Pipeline</h1>
          <p className="text-ink-soft">{company.name} · {wide ? "bids you can see across the company" : "your bids"}</p>
        </div>
        <a href={`/api/company/pipeline/export?${qs({ page: null })}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-paper" data-testid="csv-export">
          <Download className="h-4 w-4" aria-hidden /> Export CSV
        </a>
      </div>

      <Card className="p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end" aria-label="Filter bids">
          <div className="min-w-0"><label htmlFor="pf-q" className="text-sm font-semibold">Search</label>
            <input id="pf-q" name="q" defaultValue={f.q ?? ""} placeholder="Bid, customer or number" className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" /></div>
          <div><label htmlFor="pf-stage" className="text-sm font-semibold">Stage</label>
            <select id="pf-stage" name="stage" defaultValue={f.stage ?? ""} className={select}><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select></div>
          {wide && <div><label htmlFor="pf-user" className="text-sm font-semibold">Estimator</label>
            <select id="pf-user" name="user" defaultValue={f.user ?? ""} className={select}><option value="">Everyone</option>{people.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email || "Team member"}</option>)}</select></div>}
          {wide && teamList.length > 0 && <div><label htmlFor="pf-team" className="text-sm font-semibold">Team</label>
            <select id="pf-team" name="team" defaultValue={f.team ?? ""} className={select}><option value="">All teams</option>{teamList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>}
          <div><label htmlFor="pf-range" className="text-sm font-semibold">Created</label>
            <select id="pf-range" name="range" defaultValue={f.range} className={select}>{Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <button type="submit" className="min-h-11 rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-dark">Apply</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick stage filters">
          <Link href={`?${qs({ stage: null, page: 1 })}`} className={`rounded-full border px-3 py-1 text-sm ${!f.stage ? "border-brand bg-brand-tint font-semibold" : "border-line"}`}>All</Link>
          {STAGES.map((s) => <Link key={s} href={`?${qs({ stage: s, page: 1 })}`} className={`rounded-full border px-3 py-1 text-sm ${f.stage === s ? "border-brand bg-brand-tint font-semibold" : "border-line"}`}>{STAGE_LABELS[s]}</Link>)}
        </div>
      </Card>

      {error && <Notice tone="danger">Bids couldn&apos;t be loaded. Please refresh.</Notice>}

      <Card className="p-0">
        <p className="border-b border-line px-4 py-3 text-sm text-ink-soft" data-testid="pipeline-count">{total} bid{total === 1 ? "" : "s"}{total > PAGE && ` · page ${page} of ${Math.ceil(total / PAGE)}`}</p>
        {rows.length === 0 ? <p className="px-4 py-8 text-center text-ink-soft">No bids match these filters.</p> : (
          <ul className="divide-y divide-line">{rows.map((r) => (
            <li key={r.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_14rem] md:items-start" data-testid="pipeline-row">
              <div className="min-w-0">
                <Link href={`/company/bids/${r.id}`} className="font-semibold hover:text-brand">{r.title || "Untitled bid"}</Link>
                <p className="truncate text-xs text-ink-soft">{[r.estimate_number && `#${r.estimate_number}`, r.customer_name, r.owner_name].filter(Boolean).join(" · ")}</p>
                <p className="text-xs text-ink-soft">Updated {new Date(r.updated_at).toLocaleDateString()}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-end">
                <Badge tone={STAGE_TONES[r.pipeline_stage]}>{STAGE_LABELS[r.pipeline_stage]}</Badge>
                <span className="font-semibold tabular-nums">{money(r.total)}</span>
                {showMargin && r.margin_pct !== null && <span className="text-xs text-ink-soft">{Number(r.margin_pct)}% margin</span>}
              </div>
              <StageControl estimateId={r.id} stage={r.pipeline_stage} title={r.title} />
            </li>
          ))}</ul>
        )}
        {total > PAGE && (
          <div className="flex justify-between border-t border-line px-4 py-3 text-sm">
            {page > 1 ? <Link href={`?${qs({ page: page - 1 })}`} className="font-semibold text-accent-ink underline">Previous</Link> : <span />}
            {page * PAGE < total ? <Link href={`?${qs({ page: page + 1 })}`} className="font-semibold text-accent-ink underline">Next</Link> : <span />}
          </div>
        )}
      </Card>
      <p className="text-xs text-ink-soft">Totals come from each bid&apos;s latest finalized version. Generating a PDF never marks a bid as Sent; change the stage here when you actually send it.</p>
    </div>
  );
}
