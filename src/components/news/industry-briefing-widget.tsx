import Link from "next/link";
import { Newspaper } from "lucide-react";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadBriefing, loadReader } from "@/lib/news/server";
import { toCard } from "@/lib/news/format";
import { CATEGORIES, type Category } from "@/lib/news/types";
import { ArticleCard } from "./article-card";

export interface BriefingSettings { topics?: string[]; geo?: string; limit?: string | number }

/**
 * "Your Industry Briefing" dashboard widget (V6.8 §10). Free for every plan. Reads stored metadata only
 * (no external calls on render). Fills its grid cell: h-full flex column.
 */
export async function IndustryBriefingWidget({ settings = {} }: { settings?: BriefingSettings }) {
  const user = await getUser();
  if (!user) return null;
  const db = await createClient();
  const topics = (settings.topics ?? []).filter((t): t is Category => (CATEGORIES as readonly string[]).includes(t));
  const geo = (["balanced", "local", "state", "national"] as const).find((g) => g === settings.geo);
  const limit = Math.min(10, Math.max(3, Number(settings.limit) || 4));
  type Loaded = { state: "ok"; feed: Awaited<ReturnType<typeof loadBriefing>>; hasTrade: boolean; hasTrades: boolean } | { state: "error" };
  let loaded: Loaded;
  try {
    const reader = await loadReader(db, user.id);
    loaded = { state: "ok", feed: await loadBriefing(db, reader, { limit, topics, geo }), hasTrade: Boolean(reader.ctx.primaryTrade), hasTrades: reader.ctx.trades.length > 0 };
  } catch {
    loaded = { state: "error" };
  }
  let content: React.ReactNode;
  if (loaded.state === "error") {
    content = <p className="text-sm text-muted">Industry news isn&apos;t available right now.</p>;
  } else if (!loaded.feed.available) {
    content = <p className="text-sm text-muted">Industry news turns on after this month&apos;s update is installed.</p>;
  } else if (!loaded.feed.articles.length) {
    content = (
      <div className="text-sm text-muted">
        <p>No new stories for {loaded.hasTrades ? "your trades" : "you"} yet. New items arrive every morning from official and trade sources.</p>
        {!loaded.hasTrade && <p className="mt-1"><Link href="/industry/preferences" className="font-semibold text-accent-ink underline">Choose your trades</Link> to personalize it.</p>}
      </div>
    );
  } else {
    content = <ul className="space-y-2">{loaded.feed.articles.map((a) => <li key={a.id}><ArticleCard a={toCard(a)} variant="compact" /></li>)}</ul>;
  }
  return (
    <section className="flex h-full flex-col rounded-xl border border-line bg-surface p-4" aria-labelledby="industry-briefing-title" data-testid="industry-briefing">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="industry-briefing-title" className="flex items-center gap-2 font-display text-base font-extrabold text-navy"><Newspaper className="h-4 w-4 text-accent-ink" aria-hidden />Your Industry Briefing</h2>
        <Link href="/industry/preferences" className="text-xs font-semibold text-muted hover:text-ink">Personalize</Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      <Link href="/industry" className="mt-3 inline-flex items-center text-sm font-semibold text-accent-ink underline-offset-4 hover:underline" data-testid="industry-view-all">View All Industry News</Link>
    </section>
  );
}
