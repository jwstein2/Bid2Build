import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { THEME_META_KEY, parseThemePref } from "@/lib/theme";

export const dynamic = "force-dynamic";

const Body = z.object({ mode: z.enum(["light", "dark"]), at: z.number().int().nonnegative().max(8.64e15) });

/**
 * Saves the signed-in account's Light/Dark choice to auth user_metadata.b2b_theme (each user can
 * only write their own metadata). A save older than the stored one is ignored, so a slow request
 * from one device can't undo a newer choice made on another.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isSupabaseConfigured()) return fail(503, "not_configured", "Accounts aren't configured.");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const current = parseThemePref((data.user.user_metadata as Record<string, unknown> | null)?.[THEME_META_KEY]);
  if (current && current.at > p.data.at) return json({ ok: true, theme: current, stale: true });
  const { error } = await supabase.auth.updateUser({ data: { [THEME_META_KEY]: p.data } });
  if (error) {
    logError("theme.write", error);
    return fail(500, "write_failed", "Couldn't save your theme.");
  }
  return json({ ok: true, theme: p.data });
}
