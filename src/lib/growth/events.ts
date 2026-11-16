import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { inActivationWindow } from "./activation";
import { META_EVENT_FOR, queueMetaConversion } from "./conversions";

/**
 * First-party product events (public.analytics_events), recorded only from real business
 * transactions on the server. Every business event carries a stable event_id, so recording it twice
 * (autosave, refresh, auth callback retry, webhook redelivery) stores it once.
 *
 * Event names follow the existing conventions; see docs/growth/EVENTS.md for the mapping to the growth
 * spec's names (CompleteRegistration = account_created, proposal_previewed = preview_opened, ...).
 * Before migration 20261117001000 the event_id column and the new names don't exist: legacy names
 * fall back to a plain insert, new names are skipped. Never throws.
 */
export const LEGACY_EVENTS = ["landing_view", "trade_selected", "builder_started", "signup_started", "account_created", "preview_opened", "export_succeeded", "quota_reached", "checkout_started", "subscribed"] as const;
export const NEW_EVENTS = ["first_bid_started", "bid_created", "bid_activated", "proposal_sent", "subscription_renewed", "subscription_canceled"] as const;
export type ProductEvent = (typeof LEGACY_EVENTS)[number] | (typeof NEW_EVENTS)[number];

/** Stable ids: one per account for once-only milestones, one per estimate (or per day) otherwise. */
export const eventIds = {
  accountCreated: (userId: string) => `account_created:${userId}`,
  firstBidStarted: (userId: string) => `first_bid_started:${userId}`,
  bidCreated: (estimateId: string) => `bid_created:${estimateId}`,
  bidActivated: (userId: string) => `bid_activated:${userId}`,
  previewOpened: (estimateId: string, day = new Date().toISOString().slice(0, 10)) => `preview_opened:${estimateId}:${day}`,
  proposalSent: (signingRequestId: string) => `proposal_sent:${signingRequestId}`,
};

export interface EventInput { userId: string; event: ProductEvent; eventId: string; trade?: string | null; estimateId?: string | null;
  /** Subscription list value (USD) for paid conversions sent to ad platforms. Never a bid amount. */
  value?: number | null }

const missingColumn = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42703" || e.code === "PGRST204" || /event_id|estimate_id|schema cache/.test(e.message ?? "")));
const badEventName = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "23514" || /analytics_events_event_check/.test(e.message ?? "")));

/** Record an event once. Returns true if this call stored it (false: already recorded, or unavailable). */
export async function recordEvent(admin: SupabaseClient, ev: EventInput): Promise<boolean> {
  try {
    const row = { user_id: ev.userId, event: ev.event, trade: ev.trade ?? null, event_id: ev.eventId, estimate_id: ev.estimateId ?? null };
    const { data, error } = await admin.from("analytics_events").upsert(row, { onConflict: "event_id", ignoreDuplicates: true }).select("id");
    if (!error) {
      const stored = Boolean(data && data.length);
      // First time only: hand mapped milestones to the ad-conversion queue (no-op while Meta is off).
      if (stored && META_EVENT_FOR[ev.event]) await queueMetaConversion(admin, ev);
      return stored;
    }
    if (missingColumn(error) || error.code === "42P10") {
      // Migration not applied: keep the pre-existing events flowing (without dedupe), skip new names.
      if (!(LEGACY_EVENTS as readonly string[]).includes(ev.event)) return false;
      const { error: e2 } = await admin.from("analytics_events").insert({ user_id: ev.userId, event: ev.event, trade: ev.trade ?? null });
      return !e2;
    }
    if (badEventName(error)) return false;
    logError("growth.event", error, { event: ev.event });
    return false;
  } catch (e) {
    logError("growth.event", e, { event: ev.event });
    return false;
  }
}

/** Whether the account already has this once-only milestone (cheap indexed lookup by event_id). */
export async function hasEvent(admin: SupabaseClient, eventId: string): Promise<boolean> {
  const { data, error } = await admin.from("analytics_events").select("id").eq("event_id", eventId).limit(1);
  return !error && Boolean(data?.length);
}

/**
 * Mark the account activated (once) if it is still inside its 7-day window. Call after a qualifying
 * action actually succeeded: an estimate saved with 3+ meaningful items, a finalized export, or a
 * signing link created.
 */
export async function maybeActivate(admin: SupabaseClient, user: { id: string; createdAt?: string | null }, trade?: string | null): Promise<boolean> {
  if (!user.createdAt || !inActivationWindow(user.createdAt)) return false;
  return recordEvent(admin, { userId: user.id, event: "bid_activated", eventId: eventIds.bidActivated(user.id), trade });
}
