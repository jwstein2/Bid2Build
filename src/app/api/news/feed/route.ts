import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit } from "@/lib/http/api";
import { loadFeed, loadReader } from "@/lib/news/server";
import { CATEGORIES, AUTHORITIES, type Authority, type Category } from "@/lib/news/types";

/**
 * Personalized feed (JSON). Reads stored metadata only; never calls an external site.
 *   GET /api/news/feed?geo=local&trade=roofing&topic=safety&q=heat&sort=newest&limit=20&offset=0
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await rateLimit(`news-feed:${user.id}`, 120, 60_000))) return fail(429, "rate_limited", "Too many requests.");
  const sp = new URL(req.url).searchParams;
  const topic = sp.get("topic");
  const st = sp.get("source");
  const geo = sp.get("geo");
  try {
    const db = await createClient();
    const reader = await loadReader(db, user.id);
    const feed = await loadFeed(db, reader, {
      geo: geo === "local" || geo === "state" || geo === "national" ? geo : "all",
      trade: /^[a-z-]{2,40}$/.test(sp.get("trade") ?? "") ? sp.get("trade") : null,
      topic: (CATEGORIES as readonly string[]).includes(topic ?? "") ? (topic as Category) : null,
      sourceType: (AUTHORITIES as readonly string[]).includes(st ?? "") ? (st as Authority) : null,
      q: (sp.get("q") ?? "").slice(0, 100) || null,
      sort: sp.get("sort") === "newest" ? "newest" : "relevance",
      days: Number(sp.get("days")) || 60,
    }, { sample: sp.get("sample") === "1" });
    const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 20));
    const offset = Math.max(0, Number(sp.get("offset")) || 0);
    return json({ ...feed, articles: feed.articles.slice(offset, offset + limit) });
  } catch (e) {
    logError("news.feed", e);
    return fail(500, "server_error", "The news feed isn't responding. Try again.");
  }
}
