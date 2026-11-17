import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../../http/api";
import { centralDayStart, followUpDue, inBusinessHours, responseDeadline } from "./schedule";
import { footer, renderFollowUp, sendingBlockers, unresolvedPlaceholders, DEFAULT_FOLLOW_UP_BODY, type OutreachSettings } from "./templates";
import { newMessageId, outreachEnv, sendOutreachEmail, type OutreachEnv } from "./send";
import { unsubscribeToken } from "./unsubscribe";

/**
 * The creator outreach scheduler. Runs from /api/cron/creator-outreach (a Netlify scheduled function
 * calls it every 15 minutes). Does NOTHING unless every sending blocker is cleared (owner approval +
 * server env switches). Each run:
 *   1. Deadlines: awaiting-response prospects whose Friday 5 PM CT deadline passed with no reply become
 *      "No Response — First Cohort"; their cohort slot moves to the next eligible creator (who goes to
 *      the owner's approval queue; nothing is sent to them automatically).
 *   2. Follow-ups: 72h after the initial email with no reply, ONE follow-up is created from the
 *      owner-approved template.
 *   3. Sends due, approved messages inside business hours and the daily limit, re-checking reply,
 *      suppression, contact and program state immediately before each send.
 * Safe to run concurrently: messages are claimed with a conditional update; unique indexes stop a
 * second initial email or follow-up from ever existing.
 */
type Db = SupabaseClient;
export interface RunResult { disabled: boolean; blockers: string[]; deadlines: number; reallocated: number; followUpsQueued: number; sent: number; failed: number; skipped: number; outsideHours: boolean }

const MAX_ATTEMPTS = 3;

async function event(db: Db, prospectId: string, kind: string, details: Record<string, unknown> | null = null, at?: Date) {
  await db.from("creator_outreach_events").insert({ prospect_id: prospectId, kind, details, ...(at ? { at: at.toISOString() } : {}) });
}

export async function loadSettings(db: Db): Promise<OutreachSettings | null> {
  const { data } = await db.from("creator_outreach_settings").select("*").eq("id", true).maybeSingle();
  return (data as OutreachSettings | null) ?? null;
}

export async function runCreatorOutreach(db: Db, opts: { now?: Date; env?: OutreachEnv; fetchImpl?: typeof fetch } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? outreachEnv();
  const settings = await loadSettings(db);
  const blockers = sendingBlockers(settings, { enabled: env.enabled, hasKey: Boolean(env.apiKey), hasUnsubscribeSecret: Boolean(env.secret) });
  const out: RunResult = { disabled: blockers.length > 0, blockers, deadlines: 0, reallocated: 0, followUpsQueued: 0, sent: 0, failed: 0, skipped: 0, outsideHours: false };
  if (out.disabled || !settings) return out;

  // 1. Deadlines (no email involved).
  const { data: overdue } = await db.from("creator_prospects").select("id")
    .eq("stage", "awaiting_response").is("replied_at", null).lte("response_deadline_at", now.toISOString()).limit(50);
  for (const p of overdue ?? []) {
    const { data: moved } = await db.from("creator_prospects").update({ stage: "no_response_first_cohort" })
      .eq("id", p.id).eq("stage", "awaiting_response").is("replied_at", null).select("id");
    if (!moved?.length) continue;
    out.deadlines++;
    await event(db, p.id, "no_response", { deadline_passed_at: now.toISOString() });
    const { data: next } = await db.rpc("creator_outreach_reallocate", { p_prospect_id: p.id });
    if (next) out.reallocated++;
  }

  // 2. Follow-ups due (template must be approved).
  if (settings.follow_up_approved_at && settings.follow_up_body) {
    const { data: due } = await db.from("creator_prospects").select("id, first_name, gift_tier, contact_email, postponed_until")
      .eq("stage", "follow_up_scheduled").is("replied_at", null).lte("follow_up_due_at", now.toISOString()).limit(50);
    for (const p of due ?? []) {
      if (p.postponed_until && new Date(p.postponed_until) > now) continue;
      const { data: initial } = await db.from("creator_outreach_messages").select("subject, to_email").eq("prospect_id", p.id).eq("kind", "initial").eq("status", "sent").maybeSingle();
      if (!initial || initial.to_email !== p.contact_email) continue;
      const msg = renderFollowUp(settings.follow_up_subject, settings.follow_up_body ?? DEFAULT_FOLLOW_UP_BODY, {
        firstName: p.first_name, giftTier: p.gift_tier, originalSubject: initial.subject, senderName: settings.sender_name ?? "Built2Bid", deadlineIsReal: settings.cohort_deadline_is_real,
      });
      if (unresolvedPlaceholders(`${msg.subject}\n${msg.body}`).length) { await event(db, p.id, "send_failed", { reason: "unresolved placeholders in follow-up template" }); continue; }
      const { error } = await db.from("creator_outreach_messages").insert({
        prospect_id: p.id, kind: "follow_up", to_email: p.contact_email, subject: msg.subject, body_text: msg.body, status: "approved", attempts: 0,
        approved_by: settings.approved_by, approved_at: settings.follow_up_approved_at, scheduled_for: now.toISOString(),
      });
      if (!error) out.followUpsQueued++;
    }
  }

  // 3. Sends.
  if (!inBusinessHours(now, settings.business_hour_start, settings.business_hour_end)) { out.outsideHours = true; return out; }
  const { count: sentToday } = await db.from("creator_outreach_messages").select("id", { count: "exact", head: true })
    .eq("status", "sent").gte("sent_at", centralDayStart(now).toISOString());
  let budget = Math.max(0, settings.daily_send_limit - (sentToday ?? 0));
  if (!budget) return out;

  await db.from("creator_outreach_messages").update({ status: "failed", locked_until: null, last_error: "interrupted" })
    .eq("status", "sending").lt("locked_until", now.toISOString());
  const { data: queue } = await db.from("creator_outreach_messages")
    .select("id, prospect_id, kind, to_email, subject, body_text, status, attempts, scheduled_for")
    .in("status", ["approved", "failed"]).lt("attempts", MAX_ATTEMPTS)
    .or(`scheduled_for.is.null,scheduled_for.lte.${now.toISOString()}`)
    .order("kind", { ascending: true }) // "follow_up" sorts before "initial": follow-ups first
    .order("created_at", { ascending: true }).limit(25);

  for (const m of queue ?? []) {
    if (budget <= 0) break;
    // Re-check everything right before sending.
    const { data: p } = await db.from("creator_prospects").select("id, stage, contact_email, replied_at, postponed_until, program_id").eq("id", m.prospect_id).maybeSingle();
    const { data: sup } = await db.from("creator_outreach_suppressions").select("email").eq("email", (m.to_email ?? "").toLowerCase()).maybeSingle();
    const okStage = m.kind === "initial" ? p?.stage === "approved" : p?.stage === "follow_up_scheduled";
    const reason = !p ? "prospect missing" : sup ? "suppressed" : p.replied_at ? "already replied" : !okStage ? `stage is ${p.stage}`
      : !m.to_email || m.to_email !== p.contact_email ? "contact changed" : p.postponed_until && new Date(p.postponed_until) > now ? "postponed"
      : unresolvedPlaceholders(`${m.subject}\n${m.body_text}`).length ? "unresolved placeholders" : null;
    if (reason) {
      if (reason !== "postponed") await db.from("creator_outreach_messages").update({ status: "cancelled", last_error: reason }).eq("id", m.id).in("status", ["approved", "failed"]);
      out.skipped++;
      continue;
    }
    const { data: claimed } = await db.from("creator_outreach_messages")
      .update({ status: "sending", attempts: m.attempts + 1, locked_until: new Date(now.getTime() + 120_000).toISOString() })
      .eq("id", m.id).eq("status", m.status).eq("attempts", m.attempts).select("id");
    if (!claimed?.length) continue;

    let inReplyTo: string | null = null;
    if (m.kind === "follow_up") {
      const { data: initial } = await db.from("creator_outreach_messages").select("rfc_message_id").eq("prospect_id", m.prospect_id).eq("kind", "initial").eq("status", "sent").maybeSingle();
      inReplyTo = initial?.rfc_message_id ?? null;
    }
    const unsubscribeUrl = new URL(`/unsubscribe/creator?t=${encodeURIComponent(unsubscribeToken(m.to_email!, env.secret))}`, env.siteUrl).toString();
    const messageId = newMessageId();
    const res = await sendOutreachEmail(env.apiKey, {
      idempotencyKey: `creator-outreach/${m.id}`, messageId, from: `"${settings.sender_name}" <${settings.sender_email}>`, to: m.to_email!,
      replyTo: settings.reply_to ?? settings.sender_email, subject: m.subject, text: m.body_text + footer(settings, unsubscribeUrl), unsubscribeUrl, inReplyTo,
    }, opts.fetchImpl);
    // Explicit clock in tests; the real time otherwise.
    const sentAt = opts.now ? now : new Date();
    if (!res.ok) {
      const final = !res.retry || m.attempts + 1 >= MAX_ATTEMPTS;
      await db.from("creator_outreach_messages").update({ status: final ? "cancelled" : "failed", last_error: res.error, locked_until: null }).eq("id", m.id);
      await event(db, m.prospect_id, "send_failed", { kind: m.kind, error: res.error, final });
      logError("creator_outreach.send", new Error(res.error), { message: m.id, final });
      out.failed++;
      continue;
    }
    budget--;
    out.sent++;
    await db.from("creator_outreach_messages").update({ status: "sent", sent_at: sentAt.toISOString(), provider_message_id: res.id, rfc_message_id: messageId, locked_until: null, last_error: null }).eq("id", m.id);
    if (m.kind === "initial") {
      const due = followUpDue(sentAt, settings.follow_up_hours);
      await db.from("creator_prospects").update({ stage: "follow_up_scheduled", initial_sent_at: sentAt.toISOString(), follow_up_due_at: due.toISOString() }).eq("id", m.prospect_id);
      await event(db, m.prospect_id, "initial_sent", { to: m.to_email, subject: m.subject }, sentAt);
      await event(db, m.prospect_id, "follow_up_scheduled", { due_at: due.toISOString() }, sentAt);
    } else {
      const deadline = responseDeadline(sentAt);
      await db.from("creator_prospects").update({ stage: "awaiting_response", follow_up_sent_at: sentAt.toISOString(), response_deadline_at: deadline.toISOString() }).eq("id", m.prospect_id);
      await event(db, m.prospect_id, "follow_up_sent", { to: m.to_email, subject: m.subject }, sentAt);
      await event(db, m.prospect_id, "deadline_set", { deadline_at: deadline.toISOString() }, sentAt);
    }
  }
  return out;
}
