import Link from "next/link";
import { Chip, Empty, PageHead, Panel, PanelLink } from "@/components/admin/cc";
import { requireAdmin } from "@/lib/admin/server";
import { loadReport } from "@/lib/admin/load";
import { classify } from "@/lib/radar/classify";
import { draftFirstReply } from "@/lib/radar/draft";
import { radarAttribution, weeklyDigest, whyItMatters } from "@/lib/radar/report";
import { loadRadar } from "@/lib/radar/server";
import { canAutoDiscover, getSource, linksAllowed, SOURCES } from "@/lib/radar/sources";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly digest · Radar" };

export default async function RadarDigest() {
  const { db } = await requireAdmin();
  const data = await loadRadar(db);
  const now = new Date();
  const dg = weeklyDigest(data.opps, data.drafts, now);
  const report = await loadReport({ range: "7d" }).catch(() => ({ r: null }));
  const attr = report.r ? radarAttribution(report.r.facts.filter((f) => Date.parse(f.createdAt) >= now.getTime() - 7 * 86_400_000)) : null;
  const blockers = SOURCES.filter((s) => s.priority !== "low").map((s) => ({ s, r: canAutoDiscover(s.key, data.states.get(s.key)) })).filter((x) => !x.r.ok);
  const week = `${new Date(now.getTime() - 6 * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="space-y-6">
      <PageHead kicker={`Opportunity Radar · week of ${week}`} title="Weekly opportunity digest"
        intro={`${dg.recent.length} discussion${dg.recent.length === 1 ? "" : "s"} imported this week, ${dg.postedThisWeek} repl${dg.postedThisWeek === 1 ? "y" : "ies"} posted. Generated on demand from your own records; nothing is emailed or posted.`}
        right={<PanelLink href="/admin/marketing/radar">Opportunity Radar</PanelLink>} />

      <Panel kicker="1–3" title="Five most promising discussions">
        {dg.top.length === 0 ? <Empty>No open discussions without a reply. Import a few this week.</Empty> : (
          <ol className="space-y-4">
            {dg.top.map((o, i) => {
              const draft = draftFirstReply({ seed: o.id, sourceKey: o.source_key, title: o.title, text: o.excerpt ?? "", classification: classify({ title: o.title, text: o.excerpt ?? "" }), linksAllowed: linksAllowed(o.source_key, data.states.get(o.source_key)), allowProductMention: o.allow_product_mention });
              return (
                <li key={o.id} className="rounded-lg border border-[var(--cc-line)] p-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">{i + 1}. <Link href={`/admin/marketing/radar/${o.id}`} className="hover:underline">{o.title}</Link><Chip tone="green">{o.score}</Chip><Chip tone="muted">{getSource(o.source_key)?.name}</Chip></p>
                  <p className="mt-1 text-xs text-ink-soft"><span className="text-white">Why it matters:</span> {whyItMatters(o)}</p>
                  {draft && <p className="mt-2 whitespace-pre-wrap rounded-md bg-[rgb(5_9_12/0.5)] p-2 text-xs text-ink-soft"><span className="cc-kicker mb-1 block">Suggested response (review before use)</span>{draft.body}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel kicker="4" title={`Follow-ups needing attention (${dg.followups.length})`}>
          {dg.followups.length === 0 ? <Empty>None.</Empty> : <ul className="space-y-1 text-sm">{dg.followups.map((o) => <li key={o.id}><Link href={`/admin/marketing/radar/${o.id}`} className="text-white underline">{o.title}</Link></li>)}</ul>}
        </Panel>
        <Panel kicker="7" title="Attributable conversions this week">
          {attr ? <p className="text-sm text-ink-soft"><span className="text-white">{attr.signups}</span> signups, <span className="text-white">{attr.firstBids}</span> started a bid, <span className="text-white">{attr.paid}</span> paying, from visits tagged utm_campaign=opportunity_radar. Observed first touch only; replies are not assumed to cause signups.</p> : <p className="text-sm text-muted">Signup records unavailable.</p>}
        </Panel>
      </div>

      <Panel kicker="5–6" title="Recurring estimating problems and suggested content">
        <p className="mb-3 text-xs text-[var(--cc-amber)]">{dg.trends.caveat}</p>
        {dg.trends.trends.length === 0 ? <Empty>Not enough discussions yet.</Empty> : (
          <ul className="space-y-2 text-sm">
            {dg.trends.trends.slice(0, 6).map((t) => <li key={t.pain}><span className="font-semibold text-white">{t.pain}</span> <span className="cc-mono text-xs text-muted">({t.count} of {dg.trends.sample})</span>{t.ideas[0] && <span className="text-ink-soft"> · {t.ideas.map((x) => `${x.type}: ${x.idea}`).join(" · ")}</span>}</li>)}
          </ul>
        )}
      </Panel>

      <Panel kicker="8" title="Platform access and policy blockers">
        <ul className="space-y-1 text-xs text-ink-soft">{blockers.map(({ s, r }) => <li key={s.key}><span className="text-white">{s.name}:</span> {(r as { reason: string }).reason}</li>)}</ul>
      </Panel>
    </div>
  );
}
