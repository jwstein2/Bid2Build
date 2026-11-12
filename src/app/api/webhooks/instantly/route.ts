import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { normalizeEmail } from "@/lib/growth/attribution";
import { effectOf, type InstantlyPayload } from "@/lib/growth/instantly-events";
import { _findOrCreateLead, _setStage, dedupeKey } from "@/lib/growth/leads";
import { blockEmail } from "@/lib/growth/instantly";

export const runtime = "nodejs";

/**
 * Receives Instantly webhook deliveries.
 *
 * STATUS: INCOMPLETE / UNTESTED against a real Instantly workspace (no account available).
 *
 * Auth: Instantly does not sign webhooks; it lets you attach custom headers. Configure the webhook
 * with header  x-built2bid-webhook-secret: <INSTANTLY_WEBHOOK_SECRET>. Without the env var this
 * endpoint refuses everything (503).
 *
 * Stores only: lead email, event type, campaign id/name, step/variant. Never email bodies or reply text.
 * Idempotent: a hash of (event, email, campaign, timestamp, email_id) is unique in lead_events.
 */
export async function POST(req: Request) {
  const secret = process.env.INSTANTLY_WEBHOOK_SECRET;
  if (!secret || !isSupabaseConfigured()) return new Response("Webhook not configured", { status: 503 });
  const given = req.headers.get("x-built2bid-webhook-secret") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });

  const raw = await req.text();
  if (raw.length > 256_000) return new Response("Too large", { status: 413 });
  let p: InstantlyPayload;
  try { p = JSON.parse(raw) as InstantlyPayload; } catch { return new Response("Bad JSON", { status: 400 }); }
  const eventType = typeof p.event_type === "string" ? p.event_type.slice(0, 64) : "";
  const email = normalizeEmail(p.lead_email);
  if (!eventType || !email) return new Response("ignored", { status: 200 }); // e.g. account_error, campaign_completed

  const db = createAdminClient();
  try {
    const lead = await _findOrCreateLead(db, email);
    if (!lead) return new Response("ignored", { status: 200 });
    const key = dedupeKey("instantly", eventType, email, p.campaign_id, p.timestamp, p.email_id);
    const { error: dup } = await db.from("lead_events").insert({
      lead_id: lead.id, event: eventType, source: "instantly", campaign_id: p.campaign_id?.slice(0, 128) ?? null, dedupe_key: key,
      meta: { campaign_name: p.campaign_name?.slice(0, 200) ?? null, step: p.step ?? null, variant: p.variant ?? null },
      occurred_at: p.timestamp && !Number.isNaN(Date.parse(p.timestamp)) ? new Date(p.timestamp).toISOString() : new Date().toISOString(),
    });
    if (dup?.code === "23505") return new Response("duplicate", { status: 200 });
    if (dup) throw dup;

    const patch: Record<string, unknown> = {};
    if (p.campaign_id) { patch.last_campaign_id = p.campaign_id.slice(0, 128); patch.last_campaign_name = p.campaign_name?.slice(0, 200) ?? null; }
    if (!lead.first_touch_at && p.campaign_id) {
      Object.assign(patch, { first_touch_at: new Date().toISOString(), source: "instantly", first_campaign_id: p.campaign_id.slice(0, 128), first_campaign_name: p.campaign_name?.slice(0, 200) ?? null });
    }
    const fx = effectOf(eventType);
    if (fx.suppress) {
      if (fx.suppress === "unsubscribed") patch.unsubscribed_at = new Date().toISOString();
      if (!lead.suppressed_at) { patch.suppressed_at = new Date().toISOString(); patch.suppression_reason = fx.suppress; }
    }
    if (Object.keys(patch).length) await db.from("leads").update(patch).eq("id", lead.id);
    if (fx.stage) await _setStage(db, lead, fx.stage);
    // Opt-out also unsubscribes them from our own promotional email (marketing_opt_in).
    if (fx.suppress === "unsubscribed" && lead.user_id) await db.from("profiles").update({ marketing_opt_in: false, marketing_opt_in_at: null }).eq("id", lead.user_id);
    if (fx.block && !lead.instantly_blocked_at) {
      const r = await blockEmail(email);
      if (r.ok) await db.from("leads").update({ instantly_blocked_at: new Date().toISOString() }).eq("id", lead.id);
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    logError("instantly.webhook", e, { event: eventType });
    return new Response("error", { status: 500 });
  }
}
