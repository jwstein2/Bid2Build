import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit } from "@/lib/http/api";
import { paramsFromUrl, runSearch } from "@/lib/search/server";

export const runtime = "nodejs";

/**
 * Universal search (V6.4). Read-only: runs as the signed-in user, so every result, count and snippet comes through
 * the tables' own row-level security (see supabase/migrations/20261220001000_universal_search.sql). No AI.
 *   GET /api/search?q=johnson                     quick results grouped by category + matching actions
 *   GET /api/search?q=johnson&mode=page&type=...  one sorted page for the results page
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await rateLimit(`search:${user.id}`, 240, 60_000))) return fail(429, "rate_limited", "Too many searches. Wait a few seconds.");
  const url = new URL(req.url);
  const params = paramsFromUrl(url.searchParams, url.searchParams.get("mode") === "page" ? "page" : "quick");
  try {
    return json(await runSearch(await createClient(), params));
  } catch (e) {
    logError("search.run", e);
    return fail(500, "server_error", "Search isn't responding. Try again.");
  }
}
