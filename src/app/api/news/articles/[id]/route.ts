import { z } from "zod/v4";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

const body = z.object({ action: z.enum(["save", "unsave", "hide", "unhide", "read", "unread", "click"]) });

/** Save / hide / mark read / record an "Open original" click for one article. Private to the signed-in user (RLS). */
export async function POST(req: Request, ctx: RouteContext<"/api/news/articles/[id]">) {
  const { id } = await ctx.params;
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Article not found.");
  if (!(await rateLimit(`news-article:${user.id}`, 240, 60_000))) return fail(429, "rate_limited", "Too many requests.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Unknown action.");
  const db = await createClient();
  const { data: article } = await db.from("news_articles").select("id").eq("id", id).maybeSingle();
  if (!article) return fail(404, "not_found", "Article not found.");
  const { data: cur } = await db.from("news_user_articles").select("saved, hidden, read_at, clicked_at, clicks").eq("user_id", user.id).eq("article_id", id).maybeSingle();
  const now = new Date().toISOString();
  const a = parsed.data.action;
  const next = {
    user_id: user.id, article_id: id, updated_at: now,
    saved: a === "save" ? true : a === "unsave" ? false : cur?.saved ?? false,
    saved_at: a === "save" ? now : a === "unsave" ? null : undefined,
    hidden: a === "hide" ? true : a === "unhide" ? false : cur?.hidden ?? false,
    read_at: a === "read" || a === "click" ? cur?.read_at ?? now : a === "unread" ? null : cur?.read_at ?? null,
    clicked_at: a === "click" ? now : cur?.clicked_at ?? null,
    clicks: (cur?.clicks ?? 0) + (a === "click" ? 1 : 0),
  };
  const { error } = await db.from("news_user_articles").upsert(next, { onConflict: "user_id,article_id" });
  if (error) {
    logError("news.article_state", error);
    return fail(500, "server_error", "Couldn't save that. Try again.");
  }
  return json({ ok: true, saved: next.saved, hidden: next.hidden, read: Boolean(next.read_at) });
}
