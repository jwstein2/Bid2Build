import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { prefsSchema, prefsToRow } from "@/lib/news/prefs";
import { loadReader } from "@/lib/news/server";

/** The signed-in user's news preferences (company defaults merged in). */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const r = await loadReader(await createClient(), user.id);
  return json({ prefs: r.prefs, profile: { trade: r.profileTrade, state: r.ctx.state, city: r.ctx.city, zip: r.ctx.zip } });
}

/** Save the user's own preferences (only whitelisted values are stored). `reset: true` goes back to company/profile defaults. */
export async function PUT(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const db = await createClient();
  if (raw?.reset === true) {
    const { error } = await db.from("news_user_prefs").delete().eq("user_id", user.id);
    if (error) return fail(500, "server_error", "Couldn't reset preferences.");
    return json({ ok: true });
  }
  const parsed = prefsSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", "Some preferences weren't valid.");
  // First save starts from what the user sees now (company defaults), then applies the change.
  const current = await loadReader(db, user.id);
  const base = current.prefs.saved ? {} : prefsToRow({ ...current.prefs, followedTrades: current.prefs.followedTrades });
  const { error } = await db.from("news_user_prefs").upsert({ user_id: user.id, ...base, ...prefsToRow(parsed.data) }, { onConflict: "user_id" });
  if (error) {
    logError("news.prefs", error);
    return fail(500, "server_error", "Couldn't save preferences.");
  }
  return json({ ok: true });
}
