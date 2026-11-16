import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { normalizeEmail } from "./attribution";
import { AD_CONSENT_KEY, parseAdConsent } from "./consent";

/**
 * Meta Conversions API (server side). OFF unless every setting is present:
 *   META_CAPI_ENABLED=true, META_PIXEL_ID (dataset id), META_CAPI_TOKEN (secret, server only).
 * Optional: META_GRAPH_VERSION (default v25.0; confirm the current version in Meta's docs before
 * enabling), META_TEST_EVENT_CODE (sends to Events Manager "Test events" only).
 *
 * Only real business milestones are sent, once each (public.ad_conversions unique event_id), and only
 * for accounts that allowed ad measurement. The browser Pixel fires the same event_id, so Meta keeps one.
 * Sent fields: event name/time/id, action_source "website", the page URL, SHA-256 of the normalized
 * email and of the account id, and _fbp/_fbc when the browser shared them. Nothing else.
 */
export type MetaEvent = "CompleteRegistration" | "ActivatedContractor" | "Subscribe";
export const MAX_ATTEMPTS = 5;

/** Product event → Meta event. Anything not listed is never sent to Meta. */
export const META_EVENT_FOR: Record<string, MetaEvent> = {
  account_created: "CompleteRegistration",
  bid_activated: "ActivatedContractor",
  subscribed: "Subscribe",
};

export interface MetaConfig { enabled: boolean; pixelId: string; token: string; version: string; testCode: string | null }
export function metaConfig(env: Record<string, string | undefined> = process.env): MetaConfig {
  const pixelId = (env.META_PIXEL_ID ?? "").trim();
  const token = env.META_CAPI_TOKEN ?? "";
  const version = /^v\d{2,3}\.\d$/.test(env.META_GRAPH_VERSION ?? "") ? env.META_GRAPH_VERSION! : "v25.0";
  return { enabled: env.META_CAPI_ENABLED === "true" && /^\d{5,20}$/.test(pixelId) && token.length > 20, pixelId, token, version, testCode: env.META_TEST_EVENT_CODE?.trim() || null };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface MetaPayload {
  event_name: MetaEvent; event_time: number; event_id: string; action_source: "website"; event_source_url: string;
  user_data: { em?: string[]; external_id?: string[]; fbp?: string; fbc?: string };
  custom_data?: { currency: "USD"; value: number };
}

/** Build the one payload Meta receives. Pure (tested): only hashed identifiers, never raw PII. */
export function buildMetaPayload(o: { event: MetaEvent; eventId: string; at: Date; userId: string; email: string | null; fbp?: string | null; fbc?: string | null; url: string; value?: number | null }): MetaPayload {
  const em = normalizeEmail(o.email);
  const user_data: MetaPayload["user_data"] = { external_id: [sha256(o.userId)] };
  if (em) user_data.em = [sha256(em)];
  if (o.fbp && /^fb\.\d\.\d+\.\d+$/.test(o.fbp)) user_data.fbp = o.fbp;
  if (o.fbc && /^fb\.\d\.\d+\.[\w-]{1,500}$/.test(o.fbc)) user_data.fbc = o.fbc;
  const p: MetaPayload = { event_name: o.event, event_time: Math.floor(o.at.getTime() / 1000), event_id: o.eventId, action_source: "website", event_source_url: o.url, user_data };
  if (o.event === "Subscribe" && o.value && o.value > 0) p.custom_data = { currency: "USD", value: Math.round(o.value * 100) / 100 };
  return p;
}

/**
 * Queue a Meta conversion for a product event that was just recorded for the first time. No-op unless
 * Meta is enabled, the event maps to a Meta event, and the account allowed ad measurement. Never throws.
 */
export async function queueMetaConversion(admin: SupabaseClient, ev: { userId: string; event: string; eventId: string; value?: number | null }, cfg = metaConfig()): Promise<"queued" | "skipped"> {
  const name = META_EVENT_FOR[ev.event];
  if (!cfg.enabled || !name) return "skipped";
  try {
    const { data } = await admin.auth.admin.getUserById(ev.userId);
    const u = data?.user;
    const consent = parseAdConsent((u?.user_metadata as Record<string, unknown> | undefined)?.[AD_CONSENT_KEY]);
    if (!u || !consent?.granted) return "skipped";
    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://built2bid.org";
    const payload = buildMetaPayload({ event: name, eventId: ev.eventId, at: new Date(), userId: ev.userId, email: u.email ?? null, fbp: consent.fbp, fbc: consent.fbc, url: `${site}/dashboard`, value: ev.value });
    const { error } = await admin.from("ad_conversions").upsert({ platform: "meta", event_id: ev.eventId, event_name: name, user_id: ev.userId, payload, test_mode: Boolean(cfg.testCode) }, { onConflict: "platform,event_id", ignoreDuplicates: true });
    if (error) { logError("meta.queue", error, { event: ev.event }); return "skipped"; }
    return "queued";
  } catch (e) {
    logError("meta.queue", e, { event: ev.event });
    return "skipped";
  }
}

type Row = { id: number; event_id: string; payload: MetaPayload; attempts: number };

/** Send queued conversions (pending, or failed with attempts left). Returns counts only. */
export async function deliverMetaConversions(admin: SupabaseClient, opts: { limit?: number; fetchImpl?: typeof fetch; cfg?: MetaConfig } = {}): Promise<{ sent: number; failed: number; disabled?: true }> {
  const cfg = opts.cfg ?? metaConfig();
  if (!cfg.enabled) return { sent: 0, failed: 0, disabled: true };
  const f = opts.fetchImpl ?? fetch;
  const { data } = await admin.from("ad_conversions").select("id, event_id, payload, attempts").eq("platform", "meta").in("status", ["pending", "failed"]).lt("attempts", MAX_ATTEMPTS).order("created_at").limit(opts.limit ?? 50);
  let sent = 0, failed = 0;
  for (const row of (data ?? []) as Row[]) {
    // Meta accepts events up to 7 days old; older ones are skipped rather than sent late.
    if (Date.now() / 1000 - row.payload.event_time > 6.5 * 86_400) { await admin.from("ad_conversions").update({ status: "skipped", last_error: "older than 7 days" }).eq("id", row.id); continue; }
    const body: Record<string, unknown> = { data: [row.payload] };
    if (cfg.testCode) body.test_event_code = cfg.testCode;
    let err: string | null = null;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8_000);
      const r = await f(`https://graph.facebook.com/${cfg.version}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal }).finally(() => clearTimeout(t));
      if (!r.ok) err = `HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`;
    } catch (e) { err = String((e as Error).message ?? e).slice(0, 300); }
    if (err) { failed++; await admin.from("ad_conversions").update({ status: "failed", attempts: row.attempts + 1, last_error: err.replace(cfg.token, "***") }).eq("id", row.id); }
    else { sent++; await admin.from("ad_conversions").update({ status: "sent", attempts: row.attempts + 1, last_error: null, sent_at: new Date().toISOString() }).eq("id", row.id); }
  }
  return { sent, failed };
}
