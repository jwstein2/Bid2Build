import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { generateStructured, isAiConfigured } from "@/lib/ai/provider";
import { runIngest, runSummaries, type FetchLike, type SummaryWriter } from "@/lib/news/ingest";
import { supabaseNewsStore } from "@/lib/news/store";
import { newsModel } from "@/lib/news/summarize";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Industry Intelligence ingestion (netlify/functions/news-cron.mts). Authorization: Bearer $EMAIL_OUTBOX_SECRET.
 *   ?phase=fetch       fetch due sources once each (free RSS / official APIs), verify, classify, dedupe, store
 *   ?phase=summarize   write Haiku "What happened" summaries for eligible (public-domain) items, within budget
 *   ?phase=purge       delete metadata past each source's retention window
 *   &force=1           ignore cadence (owner "Run now")      &only=key1,key2   limit to sources
 * Sends no email and calls no paid news API.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const q = new URL(req.url).searchParams;
  const phase = q.get("phase") ?? "fetch";
  const store = supabaseNewsStore(createAdminClient());
  try {
    if (phase === "summarize") {
      const writer = isAiConfigured() ? (generateStructured as unknown as SummaryWriter) : null;
      return json(await runSummaries(store, writer, new Date(), newsModel()));
    }
    if (phase === "purge") return json({ purged: await store.purgeExpired() });
    const only = q.get("only")?.split(",").filter((k) => /^[a-z0-9-]{2,60}$/.test(k));
    return json({ reports: await runIngest(store, { fetchImpl: fetch as unknown as FetchLike, force: q.get("force") === "1", only: only?.length ? only : undefined }) });
  } catch (e) {
    logError("news.cron", e);
    return fail(500, "server_error", "News ingestion failed.");
  }
}
