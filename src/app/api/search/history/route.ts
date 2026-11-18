import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { missingMigration } from "@/lib/operations/server";
import { SEARCH_KINDS } from "@/lib/search/kinds";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("query"), query: z.string().trim().min(2).max(100) }),
  z.object({ action: z.literal("record"), kind: z.enum(SEARCH_KINDS), id: z.uuid() }),
  z.object({ action: z.literal("forget"), id: z.uuid().optional() }),
  z.object({ action: z.literal("prefs"), historyEnabled: z.boolean().optional(), favoriteActions: z.array(z.string().regex(/^[a-z0-9_.-]{1,60}$/)).max(20).optional() }),
]);

/** Per-user search history and preferences (own rows only; respects "Don't keep search history"). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "bad_input", "Invalid request.");
  const b = parsed.data;
  const db = await createClient();
  const { error } = b.action === "query" ? await db.rpc("search_remember", { p_kind: "query", p_query: b.query })
    : b.action === "record" ? await db.rpc("search_remember", { p_kind: "record", p_record_kind: b.kind, p_record_id: b.id })
    : b.action === "forget" ? await db.rpc("search_forget", { p_id: b.id ?? null })
    : await db.rpc("search_save_preferences", { p: { ...(b.historyEnabled === undefined ? {} : { history_enabled: b.historyEnabled }), ...(b.favoriteActions ? { favorite_actions: b.favoriteActions } : {}) } });
  if (error) {
    if (missingMigration(error)) return json({ ok: false, available: false });
    logError("search.history", error);
    return fail(500, "server_error", "We couldn't save that.");
  }
  return json({ ok: true });
}
