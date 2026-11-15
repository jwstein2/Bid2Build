import Link from "next/link";
import { Chip, Empty, Kpi, Mini, PageHead, Panel, PanelLink, Table, TONE, day, fmt, type Tone } from "@/components/admin/cc";
import { SectionTitle } from "@/components/admin/report";
import { requireAdmin } from "@/lib/admin/server";
import { loadReport } from "@/lib/admin/load";
import { str } from "@/lib/admin/view";
import { BAND_LABEL, band, PRIORITY_LABEL, type Priority } from "@/lib/radar/classify";
import { overview, painPointTrends, radarAttribution, sourcePerformance, usageSummary } from "@/lib/radar/report";
import { loadRadar } from "@/lib/radar/server";
import { canAutoDiscover, getSource, SOURCES } from "@/lib/radar/sources";
import { nextAction, STATUS_LABEL, STATUSES, type OppStatus } from "@/lib/radar/state";
import { isAiConfigured } from "@/lib/ai/provider";
import { tradeName } from "@/lib/trades/catalog";
import { importAction, purgeAction, settingsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunity Radar" };

const VIEWS: { key: string; label: string; match: (s: OppStatus, score: number, used: number) => boolean }[] = [
  { key: "open", label: "Open", match: (s) => !["completed", "rejected", "archived"].includes(s) },
  { key: "high", label: "High priority", match: (s, score, used) => score >= 80 && used === 0 && !["completed", "rejected", "archived"].includes(s) },
  { key: "review", label: "Awaiting review", match: (s) => s === "awaiting_review" || s === "approved" },
  { key: "active", label: "Active", match: (s) => s === "active" },
  { key: "followups", label: "Follow-ups", match: (s) => s === "followup_pending" },
  { key: "completed", label: "Completed", match: (s) => s === "completed" },
  { key: "rejected", label: "Rejected / archived", match: (s) => s === "rejected" || s === "archived" },
  { key: "all", label: "All", match: () => true },
];

const scoreTone = (n: number): Tone => (n >= 80 ? "green" : n >= 60 ? "blue" : n >= 40 ? "amber" : "muted");
const statusTone = (s: OppStatus): Tone => (s === "followup_pending" || s === "awaiting_review" ? "amber" : s === "approved" ? "violet" : s === "active" ? "blue" : s === "completed" ? "green" : s === "new" ? "blue" : "muted");

export default async function OpportunityRadar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { db } = await requireAdmin();
  const data = await loadRadar(db);

  if (!data.installed) {
    return (
      <div className="space-y-6">
        <PageHead kicker="Marketing · Opportunity Radar" title="Opportunity Radar" intro="Find contractors already asking about estimating, answer them well, and mention Built2Bid only when it helps." />
        <Panel title="Database migration not installed">
          <p className="text-sm text-ink-soft">Apply <code className="text-white">supabase/migrations/20261116001000_opportunity_radar.sql</code> to this environment&apos;s Supabase project (owner approval required for production). Nothing else in the admin area depends on it.</p>
        </Panel>
      </div>
    );
  }

  const { opps, drafts, states, usage, settings } = data;
  const ov = overview(opps, drafts);
  const u = usageSummary(usage, settings.monthly_budget_usd);
  const trends = painPointTrends(opps);
  const perf = sourcePerformance(opps, drafts);
  // Attribution comes from the existing first-touch signup records (genuine accounts only).
  const report = await loadReport({}).catch(() => ({ r: null }));
  const attr = report.r ? radarAttribution(report.r.facts) : null;

  // Filters (validated against known values)
  const view = VIEWS.find((v) => v.key === str(sp.view)) ?? VIEWS[0];
  const fSource = SOURCES.some((s) => s.key === str(sp.source)) ? str(sp.source) : "";
  const trades = [...new Set(opps.map((o) => o.trade).filter(Boolean))] as string[];
  const fTrade = trades.includes(str(sp.trade)) ? str(sp.trade) : "";
  const fIntent = ["A", "B", "C", "D", "X"].includes(str(sp.intent)) ? str(sp.intent) : "";
  const fStatus = (STATUSES as readonly string[]).includes(str(sp.status)) ? str(sp.status) : "";
  const fDays = ["7", "30", "90"].includes(str(sp.days)) ? Number(str(sp.days)) : 0;
  const cutoff = fDays ? new Date().getTime() - fDays * 86_400_000 : 0;
  const rows = opps
    .filter((o) => view.match(o.status, o.score, o.owner_replies_used))
    .filter((o) => (!fSource || o.source_key === fSource) && (!fTrade || o.trade === fTrade) && (!fIntent || o.priority === fIntent) && (!fStatus || o.status === fStatus) && (!cutoff || Date.parse(o.posted_at ?? o.created_at) >= cutoff))
    .sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at))
    .slice(0, 200);
  const viewHref = (key: string) => `/admin/marketing/radar?view=${key}`;
  const notice = str(sp.notice);
  const error = str(sp.error);

  return (
    <div className="space-y-6">
      <PageHead kicker="Marketing · Opportunity Radar" title="Opportunity Radar"
        intro="Find contractors already asking about estimating, answer the question well, and mention Built2Bid only when it genuinely helps. Every reply is approved by you and posted by you."
        right={<div className="flex flex-wrap gap-2"><PanelLink href="/admin/marketing/radar/digest">Weekly digest</PanelLink><PanelLink href="/admin/marketing/radar/sources">Sources &amp; compliance</PanelLink><PanelLink href="/admin/marketing">Marketing</PanelLink></div>} />
      {notice && <p role="status" className="rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-sm text-[var(--cc-green)]">{notice}</p>}
      {error && <p role="alert" className="rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-sm text-[var(--cc-red)]">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="New discussions" value={ov.newCount} tone="blue" href={viewHref("open")} def="Imported and scored, no reply drafted yet." />
        <Kpi label="High priority" value={ov.high} tone="green" href={viewHref("high")} def="Score 80+ with no reply yet. The score is a review priority, not a purchase probability." />
        <Kpi label="Awaiting review" value={ov.awaitingReview} tone="amber" href={viewHref("review")} def="A draft reply is waiting for your approval or posting." />
        <Kpi label="Active" value={ov.active} tone="blue" href={viewHref("active")} def="You posted reply 1; watching for a direct reply." />
        <Kpi label="Follow-ups" value={ov.followups} tone="amber" href={viewHref("followups")} def="Someone replied to you; reply 2 awaits approval." />
        <Kpi label="Completed" value={ov.completed} tone="green" href={viewHref("completed")} def="Two replies used or closed by you. No further outreach." />
        <Kpi label="Rejected" value={ov.rejected} tone="muted" href={viewHref("rejected")} def="Irrelevant, archived or removed." />
        <Kpi label="Automated sources" value={SOURCES.filter((s) => canAutoDiscover(s.key, states.get(s.key)).ok).length} sub={`${SOURCES.filter((s) => states.get(s.key)?.enabled !== false).length} sources on for manual import`} tone="violet" href="/admin/marketing/radar/sources" def="Automated sources need platform approval and a connector. Manual import works for every enabled source." />
      </div>

      <SectionTitle id="import" kicker="Discovery" title="Import a discussion" />
      <Panel>
        <form action={importAction} className="grid grid-cols-1 gap-3 lg:grid-cols-6">
          <label className="text-xs lg:col-span-3"><span className="cc-kicker mb-1 block">Discussion link</span><input name="url" type="url" required maxLength={2000} placeholder="https://www.reddit.com/r/Contractor/comments/…" className="field field-sm" /></label>
          <label className="text-xs lg:col-span-3"><span className="cc-kicker mb-1 block">Title</span><input name="title" required maxLength={300} placeholder="What estimating software do you guys use?" className="field field-sm" /></label>
          <label className="text-xs lg:col-span-6"><span className="cc-kicker mb-1 block">The question (paste the original post; first 1,500 characters are kept)</span><textarea name="text" rows={4} maxLength={5000} className="field field-sm" placeholder="Paste only the original post. Don't paste names, emails or phone numbers." /></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Posted on</span><input name="posted_at" type="date" className="field field-sm" /></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Answers so far</span><input name="reply_count" type="number" min={0} className="field field-sm" /></label>
          <label className="flex items-end gap-2 pb-2 text-xs text-ink-soft lg:col-span-2"><input type="checkbox" name="reply_blocked" className="h-4 w-4" />Community doesn&apos;t allow vendor replies here</label>
          <div className="flex items-end lg:col-span-2"><button type="submit" className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-1.5 text-sm font-bold text-[#03140c]">Import &amp; score</button></div>
        </form>
        <p className="mt-3 text-xs text-muted">Built2Bid never opens or downloads the link: you paste what you read. Skool, Reddit, Facebook, LinkedIn and forums are manual-only; see Sources &amp; compliance. Duplicates are caught by canonical link and discussion id. Daily import limit: {settings.max_imports_per_day}.</p>
      </Panel>

      <SectionTitle id="queue" kicker="Opportunities" title={`${view.label} (${fmt(rows.length)})`} />
      <Panel>
        <div className="mb-4 flex flex-wrap gap-1.5">{VIEWS.map((v) => <Link key={v.key} href={viewHref(v.key)} aria-current={v.key === view.key ? "page" : undefined} className={`cc-mono rounded-md border px-2 py-1 text-[11px] ${v.key === view.key ? "border-[var(--cc-green)] text-[var(--cc-green)]" : "border-[var(--cc-line)] text-ink-soft hover:text-white"}`}>{v.label}</Link>)}</div>
        <form method="get" action="/admin/marketing/radar" className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
          <input type="hidden" name="view" value={view.key} />
          <label className="text-xs"><span className="cc-kicker mb-1 block">Source</span><select name="source" defaultValue={fSource} className="field field-sm"><option value="">All</option>{SOURCES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Trade</span><select name="trade" defaultValue={fTrade} className="field field-sm"><option value="">All</option>{trades.map((t) => <option key={t} value={t}>{tradeName(t)}</option>)}</select></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Intent</span><select name="intent" defaultValue={fIntent} className="field field-sm"><option value="">All</option>{(["A", "B", "C", "D", "X"] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Status</span><select name="status" defaultValue={fStatus} className="field field-sm"><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Date</span><select name="days" defaultValue={fDays ? String(fDays) : ""} className="field field-sm"><option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
          <div className="flex items-end"><button type="submit" className="cc-mono rounded-md border border-[var(--cc-line-strong)] px-3 py-1.5 text-sm text-white">Filter</button></div>
        </form>
        {rows.length === 0 ? <Empty>No discussions here yet. Import one above.</Empty> : (
          <Table head={["Source", "Discussion", "Date", "Topic", "Trade", "Intent", "Score", "Status", "Replies", "Next action"]} align={["l", "l", "l", "l", "l", "l", "r", "l", "r", "l"]} minWidth={1180}>
            {rows.map((o) => (
              <tr key={o.id} data-testid="radar-row">
                <td className="font-sans text-xs text-ink-soft">{getSource(o.source_key)?.platform === "Forum" ? getSource(o.source_key)?.name : getSource(o.source_key)?.platform ?? o.source_key}</td>
                <td className="max-w-[22rem] font-sans">
                  <Link href={`/admin/marketing/radar/${o.id}`} className="font-semibold text-white hover:underline">{o.title}</Link>
                  <a href={o.canonical_url} target="_blank" rel="noopener noreferrer nofollow" className="ml-2 text-[11px] text-[var(--cc-blue)] underline" aria-label={`Open discussion: ${o.title}`}>open ↗</a>
                </td>
                <td className="whitespace-nowrap text-xs">{day(o.posted_at ?? o.created_at)}</td>
                <td className="max-w-[10rem] truncate font-sans text-xs">{o.topics[0] ?? "–"}</td>
                <td className="font-sans text-xs">{o.trade ? tradeName(o.trade) : "–"}</td>
                <td><Chip tone={o.priority === "A" ? "green" : o.priority === "B" ? "blue" : o.priority === "C" ? "violet" : "muted"}>{o.priority}</Chip></td>
                <td className="text-right"><span title={BAND_LABEL[band(o.score)]} style={{ color: TONE[scoreTone(o.score)] }} className="font-bold">{o.score}</span></td>
                <td><Chip tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}{o.reopened ? " · reopened" : ""}</Chip></td>
                <td className="text-right">{o.owner_replies_used}/2</td>
                <td className="font-sans text-xs text-ink-soft">{nextAction({ ...o, score: o.score })}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">Score bands: 80–100 high-priority review · 60–79 potential · 40–59 research or educational · under 40 archive. Scores rank what to read first; they are not purchase probabilities.</p>
      </Panel>

      <SectionTitle id="report" kicker="Reporting" title="Outcomes that matter" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Panel title="Funnel" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2">
            <Mini label="Discovered" value={ov.discovered} />
            <Mini label="Qualified (60+)" value={ov.qualified} tone="blue" />
            <Mini label="High intent (A, 80+)" value={ov.highIntent} tone="green" />
            <Mini label="Reviewed" value={ov.reviewed} />
            <Mini label="Replies approved" value={ov.approved} tone="violet" />
            <Mini label="Replies posted (confirmed)" value={ov.published} tone="green" />
            <Mini label="Follow-ups received" value={ov.followupsReceived} tone="amber" />
            <Mini label="Conversations closed" value={ov.completed} />
          </div>
          <div className="mt-4 border-t border-[var(--cc-line)] pt-3">
            <p className="cc-kicker mb-2">Observed signups (first touch utm_campaign=opportunity_radar)</p>
            {attr ? (
              <div className="grid grid-cols-4 gap-2"><Mini label="Signups" value={attr.signups} tone="green" /><Mini label="Started bid" value={attr.firstBids} /><Mini label="Activated" value={attr.activated} /><Mini label="Paying" value={attr.paid} tone="violet" /></div>
            ) : <p className="text-xs text-muted">Signup records unavailable right now.</p>}
            <p className="mt-2 text-[11px] text-muted">Observed: accounts whose first visit carried the Radar tag. Not counted: anyone who saw a reply and came back later untagged, so this undercounts. Posting a reply in the same week as a signup is never treated as the cause. Website visits need GA4 (see Marketing).</p>
          </div>
        </Panel>
        <Panel title="Source performance" className="lg:col-span-3">
          {perf.length === 0 ? <Empty>No discussions yet.</Empty> : (
            <Table head={["Source", "Discovered", "Qualified", "Avg score", "Replies posted", "Follow-ups"]} align={["l", "r", "r", "r", "r", "r"]} minWidth={520}>
              {perf.map((p) => <tr key={p.key}><td className="font-sans">{p.name}</td><td className="text-right">{p.discovered}</td><td className="text-right text-white">{p.qualified}</td><td className="text-right">{p.avgScore}</td><td className="text-right">{p.posted}</td><td className="text-right">{p.followups}</td></tr>)}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted">Qualified conversations matter more than reply volume. Ten useful answers beat a hundred promotional ones.</p>
        </Panel>
      </div>

      <SectionTitle id="learning" kicker="Market learning" title="Recurring contractor frustrations" />
      <Panel>
        <p className="mb-3 text-xs text-[var(--cc-amber)]">{trends.caveat}</p>
        {trends.trends.length === 0 ? <Empty>Patterns appear after a few relevant discussions are imported.</Empty> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {trends.trends.slice(0, 8).map((t) => (
              <div key={t.pain} className="min-w-0 overflow-hidden break-words rounded-lg border border-[var(--cc-line)] p-3">
                <p className="flex items-center justify-between text-sm font-semibold text-white">{t.pain}<span className="cc-mono text-xs text-ink-soft">{t.count} of {trends.sample}</span></p>
                <ul className="mt-1.5 space-y-0.5 text-xs">{t.examples.map((e) => <li key={e.url} className="truncate"><a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--cc-blue)] underline">{e.title}</a></li>)}</ul>
                {t.ideas.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">{t.ideas.map((i) => <li key={i.idea}><Chip tone="violet">{i.type}</Chip> {i.idea}</li>)}</ul>}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <SectionTitle id="costs" kicker="Cost and efficiency" title="Operating cost and usage" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Panel title={`This month (${u.month})`} className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2">
            <Mini label="Radar AI spend" value={`$${u.costUsd.toFixed(2)}`} tone={u.overBudget ? "red" : "green"} />
            <Mini label="Budget left" value={`$${u.remainingUsd.toFixed(2)}`} />
            <Mini label="AI drafts" value={u.aiDrafts} />
            <Mini label="Imports" value={u.imports} />
            <Mini label="Platform API calls" value={u.apiCalls} />
            <Mini label="API quota units" value={u.quotaUnits} />
          </div>
          <p className="mt-3 text-xs text-muted">Classification and scoring run on built-in rules at no cost. AI is used only when you click &quot;Draft with AI&quot;, and stops at the monthly budget. No paid scraping or monitoring services are used. Hosting and database are the existing Netlify and Supabase plans (no added cost).</p>
        </Panel>
        <Panel title="Settings" className="lg:col-span-3">
          <form action={settingsAction} className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs"><span className="cc-kicker mb-1 block">Monthly Radar AI budget (USD)</span><input name="budget" type="number" min={0} max={1000} step="0.5" defaultValue={settings.monthly_budget_usd} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Max imports per day</span><input name="max_imports" type="number" min={1} max={500} defaultValue={settings.max_imports_per_day} className="field field-sm" /></label>
            <label className="text-xs"><span className="cc-kicker mb-1 block">Keep pasted text for closed items (days)</span><input name="retention" type="number" min={7} max={730} defaultValue={settings.retention_days} className="field field-sm" /></label>
            <label className="flex items-end gap-2 pb-2 text-xs text-ink-soft"><input type="checkbox" name="ai" defaultChecked={settings.ai_drafting_enabled} className="h-4 w-4" />Allow AI drafting {isAiConfigured() ? "" : "(no AI key configured)"}</label>
            <div className="sm:col-span-2"><button type="submit" className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-1.5 text-sm font-bold text-[#03140c]">Save settings</button></div>
          </form>
          <form action={purgeAction} className="mt-4 border-t border-[var(--cc-line)] pt-3">
            <button type="submit" className="cc-mono rounded-md border border-[var(--cc-line-strong)] px-3 py-1.5 text-xs text-white">Clear old pasted text now</button>
            <span className="ml-2 text-xs text-muted">Deletes stored post text for rejected, archived and completed items older than {settings.retention_days} days. Links and your reply history stay.</span>
          </form>
        </Panel>
      </div>
    </div>
  );
}
