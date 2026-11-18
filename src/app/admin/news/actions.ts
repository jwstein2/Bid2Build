"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { audit, requireAdmin } from "@/lib/admin/server";
import { newsSource } from "@/lib/news/sources";
import { runIngest, type FetchLike } from "@/lib/news/ingest";
import { supabaseNewsStore } from "@/lib/news/store";
import { trades } from "@/lib/trades/catalog";
import { CATEGORIES, GEO_LEVELS } from "@/lib/news/types";

/**
 * Owner source controls (V6.8 §18). Owners can switch sources on/off, exclude low-quality ones and correct
 * a source's trades/geo/categories. They cannot add a source or change its rights policy here: those
 * live in src/lib/news/sources.ts (reviewed in a pull request), so copyright rules can't be loosened from a form.
 */

const SLUGS = new Set(trades.map((t) => t.slug));

export async function setSourceEnabled(key: string, enabled: boolean) {
  const { user, db } = await requireAdmin();
  if (!newsSource(key)) return;
  await db.from("news_source_state").upsert({ source_key: key, enabled, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "source_key" });
  await audit(db, user.id, enabled ? "news.source_enable" : "news.source_disable", "news_source", key);
  revalidatePath("/admin/news");
}

export async function setSourceExcluded(key: string, excluded: boolean) {
  const { user, db } = await requireAdmin();
  if (!newsSource(key)) return;
  await db.from("news_source_state").upsert({ source_key: key, excluded, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "source_key" });
  // Excluding hides the source's stored items everywhere (feed, widget, search); including restores them.
  await db.from("news_articles").update({ status: excluded ? "excluded" : "published" }).eq("source_key", key).in("status", excluded ? ["published"] : ["excluded"]);
  await audit(db, user.id, excluded ? "news.source_exclude" : "news.source_include", "news_source", key);
  revalidatePath("/admin/news");
}

const overrideSchema = z.object({
  trades: z.string().max(800),
  categories: z.array(z.string()).max(20),
  geo: z.string().max(20),
  note: z.string().max(500),
});

export async function saveSourceOverride(key: string, form: FormData) {
  const { user, db } = await requireAdmin();
  if (!newsSource(key)) return;
  const p = overrideSchema.safeParse({ trades: String(form.get("trades") ?? ""), categories: form.getAll("categories").map(String), geo: String(form.get("geo") ?? ""), note: String(form.get("note") ?? "") });
  if (!p.success) return;
  const tradeList = p.data.trades.split(/[,\s]+/).map((s) => s.trim()).filter((s) => SLUGS.has(s));
  const cats = p.data.categories.filter((c) => (CATEGORIES as readonly string[]).includes(c));
  const geo = (GEO_LEVELS as readonly string[]).includes(p.data.geo) ? p.data.geo : null;
  await db.from("news_source_state").upsert({
    source_key: key, trades_override: tradeList.length ? tradeList : null, categories_override: cats.length ? cats : null, geo_override: geo,
    note: p.data.note || null, updated_by: user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "source_key" });
  await audit(db, user.id, "news.source_override", "news_source", key, { trades: tradeList, categories: cats, geo });
  revalidatePath("/admin/news");
}

/** Fetch one source now (ignores cadence). Applies to new items; the override does not rewrite stored ones. */
export async function runSourceNow(key: string) {
  const { user, db } = await requireAdmin();
  if (!newsSource(key)) return;
  await runIngest(supabaseNewsStore(db), { fetchImpl: fetch as unknown as FetchLike, force: true, only: [key] });
  await audit(db, user.id, "news.source_run", "news_source", key);
  revalidatePath("/admin/news");
}

/** Hide one stored article everywhere (misclassified or not useful). */
export async function hideArticle(id: string) {
  const { user, db } = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.from("news_articles").update({ status: "hidden" }).eq("id", id);
  await audit(db, user.id, "news.article_hide", "news_article", id);
  revalidatePath("/admin/news");
}
