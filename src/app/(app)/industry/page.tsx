import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Newspaper, SlidersHorizontal } from "lucide-react";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadFeed, loadReader, type FeedFilters } from "@/lib/news/server";
import { toCard } from "@/lib/news/format";
import { CATEGORY_LABEL } from "@/lib/news/categories";
import { AUTHORITY_LABEL } from "@/lib/news/sources";
import { AUTHORITIES, CATEGORIES, type Authority, type Category } from "@/lib/news/types";
import { tradeName, trades } from "@/lib/trades/catalog";
import { FollowTopic } from "@/components/news/follow-topic";
import { ArticleList } from "@/components/news/article-list";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Industry Intelligence", robots: { index: false } };

const PAGE = 20;
const GEOS = [{ v: "all", l: "All News" }, { v: "local", l: "Local" }, { v: "state", l: "State" }, { v: "national", l: "National" }] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Full Industry Intelligence page (V6.8 §11): filters, search, sort, save/archive/read, original links. Free for every plan. */
export default async function IndustryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login?next=/industry");
  const db = await createClient();
  const reader = await loadReader(db, user.id);
  const geo = (GEOS.find((g) => g.v === one(sp.geo))?.v ?? "all") as FeedFilters["geo"];
  const topic = (CATEGORIES as readonly string[]).includes(one(sp.topic)) ? (one(sp.topic) as Category) : null;
  const source = (AUTHORITIES as readonly string[]).includes(one(sp.source)) ? (one(sp.source) as Authority) : null;
  const trade = trades.some((t) => t.slug === one(sp.trade)) ? one(sp.trade) : null;
  const view = one(sp.view) === "saved" ? "saved" : one(sp.view) === "hidden" || one(sp.view) === "archived" ? "hidden" : "all";
  const days = [7, 30, 60, 180].includes(Number(one(sp.days))) ? Number(one(sp.days)) : 60;
  const q = one(sp.q).slice(0, 100);
  const publisher = one(sp.publisher).slice(0, 200) || null;
  const sort = one(sp.sort) === "newest" ? "newest" : "relevance";
  const sample = one(sp.sample) === "1";
  const page = Math.max(1, Math.min(20, Number(one(sp.page)) || 1));
  const feed = await loadFeed(db, reader, { geo, topic, sourceType: source, trade, view, days, q: q || null, publisher, sort }, { sample });
  const shown = feed.articles.slice(0, page * PAGE);
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = { geo: geo === "all" ? null : geo ?? null, topic, source, trade, view: view === "all" ? null : view === "hidden" ? "archived" : view, days: days === 60 ? null : String(days), q: q || null, publisher, sort: sort === "relevance" ? null : sort, sample: sample ? "1" : null, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/industry?${s}` : "/industry";
  };
  const followed = reader.ctx.trades.map(tradeName);
  const place = [reader.ctx.city, reader.ctx.state].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-4xl space-y-5" data-guide-page="industry">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-extrabold text-navy"><Newspaper className="h-7 w-7 text-accent-ink" aria-hidden />Industry Intelligence</h1>
          <p className="mt-1 text-ink-soft">
            {followed.length ? <>Local, state and national news for <span className="font-semibold">{followed.slice(0, 3).join(", ")}{followed.length > 3 ? ` +${followed.length - 3}` : ""}</span></> : "Local, state and national construction news"}
            {place ? <> near <span className="font-semibold">{place}</span></> : null}. Included free with every plan.
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/industry/preferences" variant="secondary" size="sm"><SlidersHorizontal className="h-4 w-4" aria-hidden />Preferences</ButtonLink>
          <ButtonLink href="/industry/sources" variant="ghost" size="sm">Sources</ButtonLink>
        </div>
      </div>

      {sample && <Notice tone="warn" title="Sample mode">These are fictional sample stories that show how the feed works. They are not real news. <Link href={qs({ sample: null })} className="font-semibold underline">Back to the live feed</Link></Notice>}
      {!reader.ctx.primaryTrade && !sample && <Notice title="Personalize your feed">Add your trade on your <Link href="/settings/company" className="font-semibold underline">company profile</Link> or in <Link href="/industry/preferences" className="font-semibold underline">news preferences</Link> to see news for your work.</Notice>}
      {!reader.hasAddress && !sample && <Notice title="Add your business address for local and state news">We use the address on your <Link href="/settings/company" className="font-semibold underline">company profile</Link> (no GPS). Without it you&apos;ll see national news only.</Notice>}

      <nav aria-label="Geography" className="flex flex-wrap gap-2">
        {GEOS.map((g) => (
          <Link key={g.v} href={qs({ geo: g.v === "all" ? null : g.v, page: null })} aria-current={geo === g.v ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", geo === g.v ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink-soft hover:border-brand/50")}>{g.l}</Link>
        ))}
        <span className="mx-1 hidden w-px bg-line sm:block" aria-hidden />
        <Link href={qs({ view: view === "saved" ? null : "saved" })} aria-current={view === "saved" ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", view === "saved" ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink-soft")}>Saved</Link>
        <Link href={qs({ view: view === "hidden" ? null : "archived" })} aria-current={view === "hidden" ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", view === "hidden" ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink-soft")}>Archived</Link>
      </nav>

      <form action="/industry" method="get" className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter news">
        {geo !== "all" && <input type="hidden" name="geo" value={geo ?? ""} />}
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        {sample && <input type="hidden" name="sample" value="1" />}
        <label className="text-xs font-semibold text-muted sm:col-span-2 lg:col-span-4">Search
          <input name="q" defaultValue={q} placeholder="Headline, trade, state or publisher" className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink" />
        </label>
        <label className="text-xs font-semibold text-muted">Trade
          <select name="trade" defaultValue={trade ?? ""} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm text-ink">
            <option value="">My trades</option>
            {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Topic
          <select name="topic" defaultValue={topic ?? ""} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm text-ink">
            <option value="">All topics</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Source type
          <select name="source" defaultValue={source ?? ""} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm text-ink">
            <option value="">All sources</option>
            {AUTHORITIES.map((a) => <option key={a} value={a}>{AUTHORITY_LABEL[a]}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Publisher
          <select name="publisher" defaultValue={publisher ?? ""} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm text-ink">
            <option value="">All publishers</option>
            {feed.publishers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Date
          <select name="days" defaultValue={String(days)} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm text-ink">
            <option value="7">Past week</option><option value="30">Past 30 days</option><option value="60">Past 60 days</option><option value="180">Past 6 months</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Sort
          <select name="sort" defaultValue={sort} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm text-ink">
            <option value="relevance">Most relevant</option><option value="newest">Newest first</option>
          </select>
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
          <button type="submit" className={buttonClass("primary", "sm")}>Apply</button>
          <Link href={sample ? "/industry?sample=1" : "/industry"} className={buttonClass("ghost", "sm")}>Clear</Link>
          {topic && !sample && <FollowTopic topic={topic} following={reader.prefs.topics.includes(topic)} topics={reader.prefs.topics} />}
        </div>
      </form>

      <p className="text-xs text-muted" aria-live="polite">
        {feed.total} {feed.total === 1 ? "article" : "articles"}{feed.lastUpdated && !sample ? ` · sources last checked ${new Date(feed.lastUpdated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT` : ""}. Dates are each article&apos;s original publication date.
      </p>

      {!feed.available ? (
        <Notice title="Your first stories are on the way">New stories from official and trade sources arrive every morning. Meanwhile you can <Link href="/industry?sample=1" className="font-semibold underline">preview with sample stories</Link>.</Notice>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-soft" data-testid="news-empty">
          {view === "saved" ? <p>You haven&apos;t saved any articles yet. Use <span className="font-semibold">Save</span> on any story to keep it here.</p>
            : view === "hidden" ? <p>No archived articles. Use <span className="font-semibold">Archive</span> on any story to clear it from your feed. It will wait here, and you can bring it back any time.</p>
            : q || topic || trade || publisher || source || geo !== "all" ? <p>No articles match these filters. <Link href={sample ? "/industry?sample=1" : "/industry"} className="font-semibold text-accent-ink underline">Clear filters</Link></p>
            : <><p className="font-semibold text-ink">No stories for you yet.</p><p className="mt-1">New items arrive each morning from official agencies and trade publications. Check back tomorrow, widen your <Link href="/industry/preferences" className="font-semibold text-accent-ink underline">preferences</Link>, or <Link href="/industry?sample=1" className="font-semibold text-accent-ink underline">preview with sample stories</Link>.</p></>}
        </div>
      ) : (
        <ArticleList key={`${view}-${page}-${shown.length}`} articles={shown.map((a) => toCard(a))} sinkOnRead={view === "all"} archived={view === "hidden"} />
      )}
      {feed.articles.length > shown.length && (
        <div className="text-center"><Link href={qs({ page: String(page + 1) })} scroll={false} className={buttonClass("secondary", "md")}>Show more</Link></div>
      )}
      <p className="text-xs text-muted">Built2Bid links to original publishers and is not affiliated with, endorsed by, or a member of the associations and publications listed. Community discussions are never verified guidance. For regulations, always read the official document.</p>
    </div>
  );
}

