import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { ACTIVE_SOURCES, UNAVAILABLE_SOURCES, AUTHORITY_LABEL } from "@/lib/news/sources";
import { CATEGORIES } from "@/lib/news/types";
import { CATEGORY_LABEL } from "@/lib/news/categories";
import { newsAiSettings } from "@/lib/news/summarize";
import { hideArticle, runSourceNow, saveSourceOverride, setSourceEnabled, setSourceExcluded } from "./actions";

export const dynamic = "force-dynamic";

type State = { source_key: string; enabled: boolean; excluded: boolean; trades_override: string[] | null; categories_override: string[] | null; geo_override: string | null; note: string | null; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; last_error_at: string | null; consecutive_failures: number };
type Run = { source_key: string; phase: string; started_at: string; status: string; fetched: number; inserted: number; duplicates: number; rejected: number; reject_reasons: Record<string, number>; ai_summaries: number; ai_rejected: number; ai_cost_usd: number; api_cost_usd: number; error: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : "never");

function windows() {
  const now = new Date();
  return { since30: new Date(now.getTime() - 30 * 86400_000).toISOString(), monthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString() };
}

/** Owner Source Health (V6.8 §18–19): sources, failures, volume, freshness, cost, engagement. */
export default async function AdminNews() {
  const { db } = await requireAdmin();
  const { since30, monthStart } = windows();
  const [st, runs, arts, eng, recent] = await Promise.all([
    db.from("news_source_state").select("*"),
    db.from("news_ingest_runs").select("source_key, phase, started_at, status, fetched, inserted, duplicates, rejected, reject_reasons, ai_summaries, ai_rejected, ai_cost_usd, api_cost_usd, error").gte("started_at", since30).order("started_at", { ascending: false }).limit(2000),
    db.from("news_articles").select("source_key, published_at, summary_status, status").gte("first_seen_at", since30).limit(20000),
    db.from("news_user_articles").select("saved, hidden, clicks, read_at").gte("updated_at", since30).limit(50000),
    db.from("news_articles").select("id, headline, publisher, url, published_at, trades, geo_level, states, status").order("first_seen_at", { ascending: false }).limit(15),
  ]);
  if (st.error && /does not exist|schema cache/i.test(st.error.message)) {
    return <div className="space-y-4"><h1 className="text-3xl font-extrabold">Industry news sources</h1><Notice tone="warn" title="Not installed">Run /mnt/project-files/industry-news/run-industry-news.sql in the Supabase SQL Editor first.</Notice></div>;
  }
  const states = new Map(((st.data ?? []) as State[]).map((s) => [s.source_key, s]));
  const runRows = (runs.data ?? []) as Run[];
  const fetchRuns = runRows.filter((r) => r.phase === "fetch");
  const notModified = fetchRuns.filter((r) => r.status === "not_modified").length;
  const okRuns = fetchRuns.filter((r) => r.status === "ok" || r.status === "not_modified").length;
  const aiMonth = runRows.filter((r) => r.started_at >= monthStart).reduce((s, r) => s + Number(r.ai_cost_usd), 0);
  const apiMonth = runRows.filter((r) => r.started_at >= monthStart).reduce((s, r) => s + Number(r.api_cost_usd), 0);
  const aiWritten = runRows.reduce((s, r) => s + r.ai_summaries, 0), aiRejected = runRows.reduce((s, r) => s + r.ai_rejected, 0);
  const articles = (arts.data ?? []) as { source_key: string; published_at: string; summary_status: string; status: string }[];
  const engagement = (eng.data ?? []) as { saved: boolean; hidden: boolean; clicks: number; read_at: string | null }[];
  const budget = newsAiSettings();
  const perSource = (k: string) => articles.filter((a) => a.source_key === k);
  const newest = (k: string) => perSource(k).reduce<string | null>((m, a) => (!m || a.published_at > m ? a.published_at : m), null);
  const failures = fetchRuns.filter((r) => r.status === "failed").slice(0, 12);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Industry news sources</h1>
        <p className="mt-1 text-sm text-ink-soft">Free official feeds and publisher RSS only. Rights and new sources are changed in <code>src/lib/news/sources.ts</code> (pull request), not here. Ingestion runs daily when <code>NEWS_INGEST_ENABLED=true</code>.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><p className="text-sm text-muted">Articles added (30 days)</p><p className="text-2xl font-extrabold">{articles.length}</p><p className="text-xs text-muted">{articles.filter((a) => a.status !== "published").length} hidden/excluded</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Feed availability</p><p className="text-2xl font-extrabold">{fetchRuns.length ? Math.round((okRuns / fetchRuns.length) * 100) : 0}%</p><p className="text-xs text-muted">{fetchRuns.length} fetches · cache hit (304) {fetchRuns.length ? Math.round((notModified / fetchRuns.length) * 100) : 0}%</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Cost this month</p><p className="text-2xl font-extrabold">${(aiMonth + apiMonth).toFixed(2)}</p><p className="text-xs text-muted">AI summaries ${aiMonth.toFixed(3)} of ${budget.monthlyBudgetUsd} cap · news APIs ${apiMonth.toFixed(2)} (free feeds)</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Engagement (30 days)</p><p className="text-2xl font-extrabold">{engagement.reduce((s, e) => s + e.clicks, 0)} clicks</p><p className="text-xs text-muted">{engagement.filter((e) => e.saved).length} saved · {engagement.filter((e) => e.read_at).length} read · {engagement.filter((e) => e.hidden).length} hidden</p></Card>
      </div>
      <p className="text-xs text-muted">Summaries: {aiWritten} written, {aiRejected} rejected by the source check (30 days). Haiku summaries are {budget.enabled ? "on" : "off"} (NEWS_AI_SUMMARIES), max {budget.maxPerRun} per run.</p>

      <Card>
        <ul className="divide-y divide-line">
          {ACTIVE_SOURCES.map((s) => {
            const x = states.get(s.key);
            const enabled = x?.enabled ?? true;
            return (
              <li key={s.key} className="space-y-2 px-4 py-3" data-testid="news-source-row">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{s.name} {!enabled && <Badge>Off</Badge>} {x?.excluded && <Badge tone="danger">Excluded</Badge>} {(x?.consecutive_failures ?? 0) > 0 && <Badge tone="warn">{x!.consecutive_failures} failed</Badge>}</p>
                    <p className="text-xs text-ink-soft">{AUTHORITY_LABEL[s.authority]} · {s.summaryPolicy} · {s.cadence.replace("_", " ")} · keeps {s.retentionDays} days · <a className="underline" href={s.feedUrl} target="_blank" rel="noopener noreferrer">feed</a></p>
                    <p className="text-xs text-muted">Last OK {when(x?.last_ok_at ?? null)} · newest item {when(newest(s.key))} · {perSource(s.key).length} items in 30 days</p>
                    {x?.last_error && <p className="text-xs text-danger">Last error {when(x.last_error_at)}: {x.last_error}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <form action={runSourceNow.bind(null, s.key)}><button className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-paper">Run now</button></form>
                    <form action={setSourceEnabled.bind(null, s.key, !enabled)}><button className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-paper">{enabled ? "Disable" : "Enable"}</button></form>
                    <form action={setSourceExcluded.bind(null, s.key, !x?.excluded)}><button className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-paper">{x?.excluded ? "Include" : "Exclude"}</button></form>
                  </div>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-accent-ink">Correct trades, geography or topics</summary>
                  <form action={saveSourceOverride.bind(null, s.key)} className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-semibold">Trades (slugs, comma separated; empty = keywords decide)<input name="trades" defaultValue={(x?.trades_override ?? s.trades).join(", ")} className="mt-1 w-full rounded border border-line-strong px-2 py-1 font-normal" /></label>
                    <label className="text-xs font-semibold">Geographic relevance<select name="geo" defaultValue={x?.geo_override ?? ""} className="mt-1 w-full rounded border border-line-strong px-2 py-1 font-normal"><option value="">Default ({s.defaultGeo})</option><option value="local">Local</option><option value="state">State</option><option value="regional">Regional</option><option value="national">National</option></select></label>
                    <fieldset className="text-xs sm:col-span-2"><legend className="font-semibold">Topic categories</legend><div className="mt-1 flex flex-wrap gap-2">{CATEGORIES.map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" name="categories" value={c} defaultChecked={(x?.categories_override ?? s.categories).includes(c)} />{CATEGORY_LABEL[c]}</label>)}</div></fieldset>
                    <label className="text-xs font-semibold sm:col-span-2">Note<input name="note" defaultValue={x?.note ?? ""} className="mt-1 w-full rounded border border-line-strong px-2 py-1 font-normal" /></label>
                    <div><button className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white">Save correction</button></div>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold">Recent failures</h2>
        {!failures.length ? <p className="text-sm text-muted">None in the last 30 days.</p> : (
          <ul className="mt-2 space-y-1 text-sm">{failures.map((f, i) => <li key={i}><span className="font-semibold">{f.source_key}</span> · {when(f.started_at)} · {f.error}</li>)}</ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold">Latest stored articles</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {((recent.data ?? []) as { id: string; headline: string; publisher: string; url: string; published_at: string; trades: string[]; geo_level: string; states: string[]; status: string }[]).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline-offset-4 hover:underline">{a.headline}</a><span className="block text-xs text-muted">{a.publisher} · {when(a.published_at)} · {a.geo_level}{a.states.length ? ` (${a.states.join(", ")})` : ""} · {a.trades.slice(0, 4).join(", ") || "no trade"} · {a.status}</span></span>
              {a.status === "published" && <form action={hideArticle.bind(null, a.id)}><button className="text-xs font-semibold text-danger">Hide</button></form>}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold">Known unavailable sources</h2>
        <ul className="mt-2 space-y-1 text-sm">{UNAVAILABLE_SOURCES.map((u) => <li key={u.name}><span className="font-semibold">{u.name}:</span> {u.reason}</li>)}</ul>
        <p className="mt-2 text-xs text-muted">Members see the public version at <Link href="/industry/sources" className="underline">/industry/sources</Link>.</p>
      </Card>
    </div>
  );
}
