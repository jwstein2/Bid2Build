import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { PRIVATE_REPLY_WINDOW_MS, trialConfig, type TrialConfig } from "./config";
import { deliverTrialEmails } from "./delivery";
import { COPY, reminderAllowed, replyToComment, type Contact, type FlowDeps, type FlowStore, type InviteStatus, type OutMessage, type SendResult } from "./flow";
import { describeGraphError, sendMessage, sendPrivateReply, type Fetch } from "./meta";
import { readInviteToken } from "./token";

/**
 * The one Built2Bid trial service behind every entry point (Meta webhook, ManyChat External Request,
 * claim page). It can only ever ask Postgres for the fixed 7-day Unlimited pass.
 */

export type InviteSource = "messenger" | "manychat" | "claim_page" | "questionnaire";

/** Queue an invite and try to send it right away (the scheduled job retries failures). */
export async function requestTrialInvite(db: SupabaseClient, o: { email: string; source: InviteSource; contactId?: string | null; checkins?: boolean; fetchImpl?: Fetch }): Promise<{ status: InviteStatus; inviteId: string; delivered: boolean }> {
  const { data, error } = await db.rpc("trial_request_invite", { p_email: o.email, p_source: o.source, p_contact_id: o.contactId ?? null, p_checkins: Boolean(o.checkins) });
  if (error) throw Object.assign(new Error(error.message === "invalid_email" ? "invalid_email" : "request_failed"), { code: error.code });
  const r = data as { status: InviteStatus; invite_id: string; email_id: string | null };
  let delivered = false;
  if (r.email_id) {
    const res = await deliverTrialEmails(db, { ids: [r.email_id], fetchImpl: o.fetchImpl });
    delivered = res.sent > 0;
  }
  return { status: r.status, inviteId: r.invite_id, delivered };
}

export type ActivateOutcome =
  | { ok: true; expiresAt: string; repeat: boolean }
  | { ok: false; reason: "invalid" | "invite_expired" | "email_unverified" | "email_mismatch" | "already_has_access" | "already_used" | "error"; hint?: string };

export async function activateTrial(db: SupabaseClient, userId: string, token: unknown): Promise<ActivateOutcome> {
  const t = readInviteToken(token);
  if (!t) return { ok: false, reason: "invalid" };
  const { data, error } = await db.rpc("trial_activate", { p_user_id: userId, p_invite_id: t.id, p_token_version: t.version });
  if (error) { logError("trial.activate", error); return { ok: false, reason: "error" }; }
  const r = data as { ok: boolean; expires_at?: string; repeat?: boolean; reason?: string; hint?: string };
  if (r.ok && r.expires_at) return { ok: true, expiresAt: r.expires_at, repeat: Boolean(r.repeat) };
  return { ok: false, reason: (r.reason ?? "invalid") as Exclude<ActivateOutcome, { ok: true }>["reason"], hint: r.hint };
}

// ---------------------------------------------------------------------------
// Supabase-backed FlowStore
// ---------------------------------------------------------------------------
const CONTACT_COLS = "id, state, invite_id, reminder_due_at, reminder_sent_at, last_inbound_at, invalid_email_prompts";

export function supabaseFlowStore(db: SupabaseClient, channel: "messenger" | "manychat" = "messenger"): FlowStore {
  return {
    async claimEvent(e) {
      const { data, error } = await db.from("trial_campaign_events")
        .upsert({ dedupe_key: e.dedupeKey, kind: e.kind, page_id: e.pageId, post_id: e.postId ?? null, comment_id: e.commentId ?? null,
          occurred_at: e.occurredAt.toISOString(), status: "sending", attempts: 1, locked_until: new Date(Date.now() + 60_000).toISOString() },
          { onConflict: "dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`claim: ${error.code ?? error.message}`);
      return data?.length ? { id: data[0].id as number } : null;
    },
    async finishEvent(id, p) {
      await db.from("trial_campaign_events").update({
        status: p.status, locked_until: null,
        ...(p.lastError !== undefined ? { last_error: p.lastError } : {}),
        ...(p.replyFormat ? { reply_format: p.replyFormat } : {}),
        ...(p.contactId ? { contact_id: p.contactId } : {}),
      }).eq("id", id);
    },
    async findContact(pageId, psid) {
      const { data } = await db.from("trial_campaign_contacts").select(CONTACT_COLS).eq("channel", channel).eq("page_id", pageId).eq("psid", psid).maybeSingle();
      return (data as Contact | null) ?? null;
    },
    async touchContact(pageId, psid, now) {
      const iso = now.toISOString();
      const { data: ins } = await db.from("trial_campaign_contacts")
        .upsert({ channel, page_id: pageId, psid, interacted_at: iso, last_inbound_at: iso }, { onConflict: "channel,page_id,psid", ignoreDuplicates: true })
        .select(CONTACT_COLS);
      if (ins?.length) return ins[0] as Contact;
      const { data, error } = await db.from("trial_campaign_contacts").update({ last_inbound_at: iso })
        .eq("channel", channel).eq("page_id", pageId).eq("psid", psid).select(CONTACT_COLS).single();
      if (error || !data) throw new Error("contact unavailable");
      return data as Contact;
    },
    async updateContact(id, patch) {
      await db.from("trial_campaign_contacts").update(patch).eq("id", id);
    },
    async requestInvite(email, contactId) {
      const r = await requestTrialInvite(db, { email, source: channel === "manychat" ? "manychat" : "messenger", contactId });
      return { status: r.status, inviteId: r.inviteId };
    },
    async setCheckins(inviteId, optIn) {
      await db.rpc("trial_set_checkins", { p_invite_id: inviteId, p_opt_in: optIn });
    },
  };
}

function toSend(r: Awaited<ReturnType<typeof sendMessage>>): SendResult {
  return r.ok ? { ok: true } : { ok: false, retry: r.retry, code: r.error.code, error: describeGraphError(r.error) };
}

export function metaFlowDeps(db: SupabaseClient, cfg: TrialConfig = trialConfig(), fetchImpl?: Fetch): FlowDeps {
  return {
    cfg,
    store: supabaseFlowStore(db),
    privateReply: async (commentId: string, msg: OutMessage) => toSend(await sendPrivateReply(cfg, commentId, msg, fetchImpl)),
    message: async (psid: string, msg: OutMessage) => toSend(await sendMessage(cfg, psid, msg, fetchImpl)),
  };
}

// ---------------------------------------------------------------------------
// Scheduled job: retries + reminders + check-in emails
// ---------------------------------------------------------------------------
export async function runTrialJobs(db: SupabaseClient, opts: { cfg?: TrialConfig; fetchImpl?: Fetch; now?: Date } = {}) {
  const cfg = opts.cfg ?? trialConfig();
  const now = opts.now ?? new Date();
  const out = { replyRetries: 0, remindersSent: 0, remindersExpired: 0, emails: { sent: 0, failed: 0, skipped: 0, disabled: true } };
  if (!cfg.enabled) return out;

  if (cfg.pageToken && cfg.pageId) {
    const deps = metaFlowDeps(db, cfg, opts.fetchImpl);
    // Private replies that failed for a transient reason (or a worker that died), within Meta's window.
    const { data: events } = await db.from("trial_campaign_events").select("id, comment_id, post_id, attempts, status, locked_until")
      .eq("kind", "comment").in("status", ["failed", "sending"]).lt("attempts", 5)
      .gte("occurred_at", new Date(now.getTime() - PRIVATE_REPLY_WINDOW_MS).toISOString()).limit(25);
    for (const ev of events ?? []) {
      if (ev.status === "sending" && ev.locked_until && new Date(ev.locked_until) > now) continue;
      const { data: claimed } = await db.from("trial_campaign_events")
        .update({ status: "sending", attempts: ev.attempts + 1, locked_until: new Date(now.getTime() + 60_000).toISOString() })
        .eq("id", ev.id).eq("attempts", ev.attempts).in("status", ["failed", "sending"]).select("id");
      if (!claimed?.length || !ev.comment_id) continue;
      await replyToComment(ev.id, ev.comment_id, deps, ev.post_id as string | null);
      out.replyRetries++;
    }

    // One reminder, ~4h after "Send my invite", only while Messenger's 24h window is open.
    const { data: due } = await db.from("trial_campaign_contacts").select("id, psid, state, reminder_due_at, reminder_sent_at, last_inbound_at")
      .eq("channel", "messenger").eq("state", "awaiting_email").is("reminder_sent_at", null).lte("reminder_due_at", now.toISOString()).limit(50);
    for (const c of due ?? []) {
      const verdict = reminderAllowed(c as Pick<Contact, "state" | "reminder_due_at" | "reminder_sent_at" | "last_inbound_at">, now);
      if (verdict === "expired") {
        await db.from("trial_campaign_contacts").update({ reminder_due_at: null }).eq("id", c.id).is("reminder_sent_at", null);
        out.remindersExpired++;
        continue;
      }
      if (verdict !== "send") continue;
      // Claim first so two workers can't both send it.
      const { data: claimed } = await db.from("trial_campaign_contacts").update({ reminder_sent_at: now.toISOString() })
        .eq("id", c.id).is("reminder_sent_at", null).eq("state", "awaiting_email").select("id");
      if (!claimed?.length) continue;
      const r = await deps.message(c.psid as string, COPY.reminder);
      if (r.ok) out.remindersSent++;
      else logError("trial.reminder", new Error(r.error), { contact: c.id as string });
    }
  }

  out.emails = await deliverTrialEmails(db, { fetchImpl: opts.fetchImpl, now });
  return out;
}
