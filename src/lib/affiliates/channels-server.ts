import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChannel, parseChannelInput, youtubeConfigured } from "./youtube";

/**
 * Imports a channel for the signed-in affiliate (service role; userId comes from the verified session). Official
 * numbers come only from the YouTube Data API; the database refuses a channel another affiliate already claimed.
 */
export async function importChannel(db: SupabaseClient, userId: string, raw: string): Promise<{ ok: true; channel: Record<string, unknown> } | { ok: false; error: string }> {
  if (!youtubeConfigured()) return { ok: false, error: "youtube_off" };
  const input = parseChannelInput(raw);
  if (!input) return { ok: false, error: "bad_input" };
  try {
    const c = await fetchChannel(input);
    const { data, error } = await db.rpc("affiliate_channel_import", { p_user: userId, p: c });
    if (error) return { ok: false, error: /channel_claimed/.test(error.message) ? "channel_claimed" : /channel_id_invalid/.test(error.message) ? "not_found" : "save_failed" };
    return { ok: true, channel: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: (e as Error).message === "not_found" ? "not_found" : "youtube_error" };
  }
}

/** Daily refresh of the stalest imported channels (also completes ownership checks once the code is in the description). */
export async function refreshChannels(db: SupabaseClient, limit = 25): Promise<{ refreshed: number }> {
  if (!youtubeConfigured()) return { refreshed: 0 };
  const { data } = await db.from("affiliate_channels").select("channel_id, affiliates!inner(user_id, status)")
    .eq("platform", "youtube").eq("data_source", "youtube_api").eq("is_primary", true).not("channel_id", "is", null)
    .order("fetched_at", { ascending: true, nullsFirst: true }).limit(limit);
  let refreshed = 0;
  for (const row of (data ?? []) as unknown as { channel_id: string; affiliates: { user_id: string | null; status: string } }[]) {
    if (!row.affiliates?.user_id || ["suspended", "terminated", "rejected"].includes(row.affiliates.status)) continue;
    try {
      const c = await fetchChannel({ id: row.channel_id });
      const { error } = await db.rpc("affiliate_channel_import", { p_user: row.affiliates.user_id, p: c });
      if (!error) refreshed++;
    } catch { /* skip this one; next run retries */ }
  }
  return { refreshed };
}
