import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArticleRow, NewsStore, PendingSummary, RunRecord, SourceState } from "./ingest";

/** Supabase-backed NewsStore. Uses the service-role client (the ingestion job only). */
export function supabaseNewsStore(db: SupabaseClient): NewsStore {
  const chunk = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  return {
    async sourceStates() {
      const { data, error } = await db.from("news_source_state").select("source_key, enabled, excluded, trades_override, categories_override, geo_override, last_ok_at, last_run_at, consecutive_failures, etag, last_modified");
      if (error) throw error;
      return (data ?? []) as SourceState[];
    },
    async existingUrlKeys(keys) {
      const out = new Set<string>();
      for (const c of chunk(keys)) {
        if (!c.length) continue;
        const { data, error } = await db.from("news_articles").select("url_key").in("url_key", c);
        if (error) throw error;
        for (const r of data ?? []) out.add(r.url_key as string);
      }
      return out;
    },
    async recentFingerprints(prints, sinceIso) {
      const out = new Set<string>();
      for (const c of chunk(prints)) {
        if (!c.length) continue;
        const { data, error } = await db.from("news_articles").select("fingerprint").in("fingerprint", c).gte("published_at", sinceIso);
        if (error) throw error;
        for (const r of data ?? []) out.add(r.fingerprint as string);
      }
      return out;
    },
    async insertArticles(rows: ArticleRow[]) {
      let n = 0;
      for (const c of chunk(rows, 100)) {
        if (!c.length) continue;
        const { data, error } = await db.from("news_articles").upsert(c, { onConflict: "url_key", ignoreDuplicates: true }).select("id");
        if (error) throw error;
        n += data?.length ?? 0;
      }
      return n;
    },
    async touchArticles(urlKeys, nowIso) {
      let n = 0;
      for (const c of chunk(urlKeys)) {
        if (!c.length) continue;
        const { data, error } = await db.from("news_articles").update({ last_verified_at: nowIso }).in("url_key", c).select("id");
        if (error) throw error;
        n += data?.length ?? 0;
      }
      return n;
    },
    async saveSourceState(key, patch) {
      const { error } = await db.from("news_source_state").upsert({ source_key: key, ...patch, updated_at: new Date().toISOString() }, { onConflict: "source_key" });
      if (error) throw error;
    },
    async recordRun(run: RunRecord) {
      const { error } = await db.from("news_ingest_runs").insert(run);
      if (error) throw error;
    },
    async pendingSummaries(limit) {
      const { data, error } = await db.from("news_articles").select("id, source_key, headline, snippet, article_type, effective_on, publisher")
        .eq("summary_status", "pending").order("published_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as PendingSummary[];
    },
    async saveSummary(id, patch) {
      const { error } = await db.from("news_articles").update(patch).eq("id", id);
      if (error) throw error;
    },
    async aiSpendSince(iso) {
      const { data, error } = await db.from("news_ingest_runs").select("ai_cost_usd").gte("started_at", iso).gt("ai_cost_usd", 0).limit(5000);
      if (error) throw error;
      return (data ?? []).reduce((s, r) => s + Number(r.ai_cost_usd ?? 0), 0);
    },
    async purgeExpired() {
      const { data, error } = await db.rpc("news_purge_expired");
      if (error) throw error;
      return Number(data ?? 0);
    },
  };
}
