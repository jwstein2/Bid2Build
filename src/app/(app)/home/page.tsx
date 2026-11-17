import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { isFinancialsEnabled, isPmEnabled, isUnifiedHomeEnabled } from "@/lib/env";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { money } from "@/lib/enterprise/pipeline";
import { listSchedules } from "@/lib/schedule/server";
import { FOCUS, isStage, stageColumn, type Column } from "@/lib/pipeline/board";
import { loadFinState, loadHome, type Figure } from "@/lib/financials/loaders";
import { KPI_LABELS } from "@/lib/financials/ui-labels";
import { formatCurrency } from "@/lib/estimate/money";
import { MetricCard } from "@/components/ui/metric-card";

export const metadata: Metadata = { title: "Home", robots: { index: false } };

const figure = (f: Figure) => (f.money ? formatCurrency(f.value) : f.value);

type Pillar = { key: string; title: string; href: string; action: string; cards: { title: string; value: string | number; sub?: string; href: string; tone?: "default" | "ok" | "warn" | "danger" }[] };

/**
 * One home for every pillar (Win the Job, Run the Job, Grow, Know Your Numbers). It holds no numbers of its
 * own: each card reads the same source as the page it opens (bids, the company pipeline summary, schedules,
 * the Financials dashboard engine), so a figure here always matches the view behind it. Pillars the person
 * has no access to are left out instead of being shown as upsells.
 */
export default async function HomePage() {
  if (!isUnifiedHomeEnabled()) notFound();
  const user = await getUser();
  if (!user) redirect("/login?next=/home");
  const db = await createClient();
  const company = await loadMyCompany(db);

  const [bids, customers, summary, schedules, fin] = await Promise.all([
    db.from("estimates").select("pipeline_stage, status").eq("user_id", user.id).limit(2000),
    db.from("customers").select("id", { count: "exact", head: true }),
    company && can(company, "view_analytics") ? db.rpc("company_pipeline_summary", { p_from: null, p_to: null, p_team: null }) : Promise.resolve({ data: null }),
    isPmEnabled() ? listSchedules(db) : Promise.resolve(null),
    isFinancialsEnabled() ? loadFinState(db) : Promise.resolve(null),
  ]);

  // Same column mapping and focus filters as the Bids board, so each count matches the filtered board.
  const cols = ((bids.data ?? []) as { pipeline_stage: string | null; status: string }[])
    .map((b) => stageColumn(isStage(b.pipeline_stage) ? b.pipeline_stage : "draft", b.status as Parameters<typeof stageColumn>[1]));
  const count = (focus: readonly Column[]) => cols.filter((c) => focus.includes(c)).length;
  const openBids = count(FOCUS.open.columns), active = count(FOCUS.active.columns);
  const pillars: Pillar[] = [{
    key: "win", title: "Win the Job", href: "/dashboard", action: "Open bids",
    cards: [
      { title: FOCUS.open.label, value: openBids, href: "/dashboard?focus=open" },
      { title: FOCUS.active.label, value: active, sub: "Ready, sent or awaiting a decision", href: "/dashboard?focus=active" },
    ],
  }];
  const s = summary.data as { winRate: number | null; openValue: number; awaitingReview: number } | null;
  if (s) {
    pillars[0].cards.push(
      { title: "Company win rate", value: s.winRate === null ? "None yet" : `${Math.round(s.winRate)}%`, href: "/company" },
      { title: "Company open value", value: money(s.openValue), href: "/company/pipeline" },
    );
  }
  if (schedules) {
    const running = schedules.filter((r) => r.status === "active").length;
    pillars.push({
      key: "run", title: "Run the Job", href: "/projects", action: "Open projects",
      cards: [{ title: "Active projects", value: running, sub: `${schedules.length} total`, href: "/projects" }],
    });
  }
  pillars.push({
    key: "grow", title: "Grow the Business", href: "/dashboard/customers", action: "Open customers",
    cards: [{ title: "Customers", value: customers.count ?? 0, href: "/dashboard/customers" }],
  });
  if (fin && fin.kind === "ready") {
    const home = await loadHome(db, fin.ctx);
    const urgent = (home.alerts as { severity?: string }[]).filter((a) => a.severity === "action_required").length;
    pillars.push({
      key: "numbers", title: "Know Your Numbers", href: "/financials", action: "Open Financials",
      cards: [
        ...fin.ctx.layout.kpis.slice(0, 3).map((k) => {
          const f = home.kpis[k];
          return { title: KPI_LABELS[k], value: figure(f), sub: f.sub, href: f.href, tone: f.tone as Pillar["cards"][number]["tone"] };
        }),
        { title: "Needs action", value: urgent, href: "/financials", tone: urgent ? "danger" : "default" },
      ],
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8" data-testid="unified-home">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-extrabold">Home</h1>
          <p className="text-ink-soft">Everything that needs you today. Every number opens the page behind it.</p>
        </div>
      </header>
      {pillars.map((p) => (
        <section key={p.key} aria-labelledby={`home-${p.key}`} data-testid={`home-pillar-${p.key}`} className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 id={`home-${p.key}`} className="text-lg font-bold">{p.title}</h2>
            <Link href={p.href} className="text-sm font-semibold text-accent-ink underline">{p.action}</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {p.cards.map((c) => (
              <MetricCard key={c.title} title={c.title} value={c.value} sub={c.sub} href={c.href} tone={c.tone} testId={`home-card-${p.key}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
