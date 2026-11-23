import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { classifyChannel } from "../admin/channels";
import { dedupeKey } from "./leads";
import { type Touch, validVisitorId } from "./touches";

/** The channel of one touch, by the same rules the dashboard uses for first touch. */
export function touchChannel(t: Touch): string {
  return classifyChannel({ utm_source: t.s, utm_medium: t.m, utm_campaign: t.c, utm_content: t.ct, first_campaign_id: t.ic, referrer_host: t.rh ?? "(none)", click_id_type: t.ck, source: t.ref ? "referral" : null });
}

/** A touch row; user_id is set only by mkt_link_visitor, so a shared browser never credits the wrong account. */
export function touchRow(visitorId: string, t: Touch) {
  return {
    visitor_id: visitorId, user_id: null, touch_at: t.at, channel: touchChannel(t),
    utm_source: t.s ?? null, utm_medium: t.m ?? null, utm_campaign: t.c ?? null, utm_content: t.ct ?? null, utm_term: t.t ?? null,
    campaign_id: t.ic ?? null, ref_code: t.ref ?? null, landing_path: t.p ?? null, referrer_host: t.rh ?? null,
    click_id_type: t.ck ?? null, device_type: t.d ?? null,
    dedupe_key: dedupeKey(visitorId, t.at, t.s, t.m, t.c, t.ct, t.t, t.ic, t.ref, t.rh, t.ck),
  };
}

/**
 * Store a signed-in browser's touches on its account and link the anonymous visitor id (first account wins).
 * Cheap on repeat page loads: one indexed lookup of the newest stored touch, and nothing is written unless the
 * cookie holds a newer one. Best effort and never throws; before the migration is applied it does nothing.
 */
export async function syncTouches(db: SupabaseClient, userId: string, rawVisitor: string | null | undefined, touches: Touch[]): Promise<number> {
  const visitorId = validVisitorId(rawVisitor);
  if (!visitorId || !touches.length) return 0;
  try {
    const { data: newest, error } = await db.from("marketing_touches").select("touch_at").eq("visitor_id", visitorId).order("touch_at", { ascending: false }).limit(1);
    if (error) return 0; // migration not applied
    const after = newest?.[0]?.touch_at ? Date.parse(newest[0].touch_at as string) : -Infinity;
    const fresh = touches.filter((t) => Date.parse(t.at) > after);
    if (!fresh.length) return 0;
    const { error: e2 } = await db.from("marketing_touches").upsert(fresh.map((t) => touchRow(visitorId, t)), { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (e2) { logError("growth.touches", e2, { user: userId }); return 0; }
    // Attach earlier touches of this visitor (and keep the visitor on its first account).
    const { data: n } = await db.rpc("mkt_link_visitor", { p_visitor: visitorId, p_user: userId });
    return typeof n === "number" ? n : 0;
  } catch (e) {
    logError("growth.touches", e, { user: userId });
    return 0;
  }
}
