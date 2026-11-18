import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GEO_LABEL } from "./categories";
import { dateLabel } from "./format";
import { AUTHORITY_LABEL } from "./sources";
import type { Authority, GeoLevel } from "./types";
import { tradeName } from "@/lib/trades/catalog";

/**
 * Industry news hits for Universal Search (V6.8 §15). Public articles only, kept apart from company
 * records (own group, "Industry news · public article" label). Matches headline, publisher, trade and
 * state words; nothing from the searcher's company is read or returned here.
 */
export interface NewsHit { id: string; title: string; subtitle: string; href: string; url: string }

export async function searchNews(db: SupabaseClient, q: string, limit = 4): Promise<NewsHit[]> {
  const text = q.trim();
  if (text.length < 3) return [];
  const { data, error } = await db.rpc("news_search", { p_q: text.slice(0, 100), p_limit: limit, p_trades: null });
  if (error) return [];
  return ((data ?? []) as { id: string; headline: string; publisher: string; url: string; published_at: string; date_precision: "day" | "time"; trades: string[]; states: string[]; geo_level: GeoLevel; authority: Authority }[])
    .map((r) => ({
      id: r.id, title: r.headline, url: r.url,
      subtitle: [r.publisher, dateLabel(r.published_at, r.date_precision), r.states.length ? r.states.join(", ") : GEO_LABEL[r.geo_level], r.trades[0] ? tradeName(r.trades[0]) : null, AUTHORITY_LABEL[r.authority]].filter(Boolean).join(" · "),
      href: `/industry?q=${encodeURIComponent(text.slice(0, 100))}`,
    }));
}
