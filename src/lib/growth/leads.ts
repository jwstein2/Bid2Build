import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Attribution, normalizeEmail } from "./attribution";
import { blockEmail } from "./instantly";
import { logError } from "../http/api";

/**
 * Lead identity + lifecycle on top of public.leads / public.lead_events
 * (migration 20261112001000_growth_funnel.sql). Every function is best effort: if the migration is
 * not applied yet, or anything fails, the caller's main work (sign-in, billing) is never affected.
 */

const STAGE_ORDER = ["prospect", "contacted", "engaged", "replied", "interested", "signed_up", "activated", "paid", "churned"] as const;
export type LeadStage = (typeof STAGE_ORDER)[number];

/** Stages only move forward, except paid -> churned and churned -> paid. */
export function nextStage(current: LeadStage, proposed: LeadStage): LeadStage {
  if (current === "paid" && proposed === "churned") return "churned";
  if (current === "churned" && proposed === "paid") return "paid";
  return STAGE_ORDER.indexOf(proposed) > STAGE_ORDER.indexOf(current) ? proposed : current;
}

export const dedupeKey = (...parts: (string | number | null | undefined)[]) =>
  createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 64);

type Db = SupabaseClient;
interface LeadRow { id: string; stage: LeadStage; user_id: string | null; first_touch_at: string | null; suppressed_at: string | null; instantly_blocked_at: string | null }

async function findOrCreateLead(db: Db, email: string): Promise<LeadRow | null> {
  const sel = "id, stage, user_id, first_touch_at, suppressed_at, instantly_blocked_at";
  const { data } = await db.from("leads").select(sel).eq("email_norm", email).maybeSingle();
  if (data) return data as LeadRow;
  const { data: created, error } = await db.from("leads").insert({ email_norm: email }).select(sel).single();
  if (created) return created as LeadRow;
  if (error?.code === "23505") {
    const { data: again } = await db.from("leads").select(sel).eq("email_norm", email).maybeSingle();
    return (again as LeadRow) ?? null;
  }
  if (error) throw error;
  return null;
}

async function setStage(db: Db, lead: LeadRow, proposed: LeadStage) {
  const stage = nextStage(lead.stage, proposed);
  if (stage !== lead.stage) await db.from("leads").update({ stage, stage_changed_at: new Date().toISOString() }).eq("id", lead.id);
}

/**
 * Link a signed-in account to its lead (creating one if needed), store first-touch attribution and
 * record the signup once. Cheap on repeat calls: one indexed lookup by user_id.
 */
export async function syncSignedInUser(db: Db, user: { id: string; email: string | null }, attribution: Attribution | null): Promise<void> {
  try {
    const { data: linked, error: e1 } = await db.from("leads").select("id").eq("user_id", user.id).maybeSingle();
    if (e1) return; // migration not applied: nothing to do
    if (linked) return;
    const email = normalizeEmail(user.email);
    if (!email) return;
    const lead = await findOrCreateLead(db, email);
    if (!lead) return;
    const patch: Record<string, unknown> = { user_id: user.id };
    if (!lead.first_touch_at) {
      patch.first_touch_at = attribution?.at ?? new Date().toISOString();
      patch.source = attribution?.source ?? (attribution?.ref ? "referral" : "direct");
      if (attribution) {
        Object.assign(patch, {
          utm_source: attribution.source ?? null, utm_medium: attribution.medium ?? null, utm_campaign: attribution.campaign ?? null,
          utm_content: attribution.content ?? null, utm_term: attribution.term ?? null, landing_path: attribution.path ?? null,
          first_campaign_id: attribution.campaignId ?? null,
        });
      }
    }
    const { error } = await db.from("leads").update(patch).eq("id", lead.id).is("user_id", null);
    if (error) return;
    await setStage(db, lead, "signed_up");
    await db.from("lead_events").insert({ lead_id: lead.id, event: "signed_up", source: "app", dedupe_key: dedupeKey("signup", user.id) });
    // The implicit (fragment) sign-in flow never hits /auth/callback, so record the funnel event here.
    await db.from("analytics_events").insert({ user_id: user.id, event: "account_created" });
  } catch (e) {
    logError("growth.sync_user", e, { user: user.id });
  }
}

/** A user became a paying customer: mark the lead and stop all prospecting to them. */
export async function markCustomer(db: Db, userId: string, email: string | null): Promise<void> {
  try {
    const norm = normalizeEmail(email);
    let { data: lead } = await db.from("leads").select("id, stage, user_id, first_touch_at, suppressed_at, instantly_blocked_at").eq("user_id", userId).maybeSingle();
    if (!lead && norm) lead = await findOrCreateLead(db, norm);
    if (!lead) return;
    const l = lead as LeadRow;
    await setStage(db, l, "paid");
    await db.from("lead_events").insert({ lead_id: l.id, event: "paid", source: "stripe", dedupe_key: dedupeKey("paid", userId, new Date().toISOString().slice(0, 10)) });
    if (!l.suppressed_at) await db.from("leads").update({ suppressed_at: new Date().toISOString(), suppression_reason: "customer" }).eq("id", l.id);
    if (norm && !l.instantly_blocked_at) {
      const r = await blockEmail(norm);
      if (r.ok) await db.from("leads").update({ instantly_blocked_at: new Date().toISOString() }).eq("id", l.id);
    }
  } catch (e) {
    logError("growth.mark_customer", e, { user: userId });
  }
}

/** Subscription ended: record churn on the lead (suppression stays; they are a former customer). */
export async function markChurned(db: Db, userId: string): Promise<void> {
  try {
    const { data: lead } = await db.from("leads").select("id, stage, user_id, first_touch_at, suppressed_at, instantly_blocked_at").eq("user_id", userId).maybeSingle();
    if (!lead) return;
    await setStage(db, lead as LeadRow, "churned");
    await db.from("lead_events").insert({ lead_id: (lead as LeadRow).id, event: "churned", source: "stripe", dedupe_key: dedupeKey("churned", userId, new Date().toISOString().slice(0, 10)) });
  } catch (e) {
    logError("growth.mark_churned", e, { user: userId });
  }
}

export { findOrCreateLead as _findOrCreateLead, setStage as _setStage };
