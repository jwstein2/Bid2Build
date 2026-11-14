import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { FOUNDER_ADDRESS, FOUNDER_FROM_NAME, FOUNDER_SUBJECT, founderWelcomeHtml, founderWelcomeText } from "./founder-welcome";

/**
 * Founder welcome email delivery. Built2Bid's only automated email to customers; contractor
 * proposals are never sent by Built2Bid.
 *
 * Enqueue (Stripe webhook) and delivery are separate steps: a job is recorded first, durably and
 * idempotently, then delivered best-effort. Delivery problems never affect billing or access.
 *
 * Sending is OFF unless every setting is present:
 *   FOUNDER_EMAIL_ENABLED=true, RESEND_API_KEY, and (optionally) FOUNDER_EMAIL_FROM / FOUNDER_EMAIL_REPLY_TO.
 * While off, jobs wait as 'pending'; jobs older than FOUNDER_EMAIL_MAX_AGE_DAYS (default 3) are
 * skipped instead of sent late.
 */
export const MAX_ATTEMPTS = 5;

export interface FounderEmailConfig {
  enabled: boolean;
  apiKey: string;
  from: string;
  replyTo: string;
  maxAgeDays: number;
}

export function founderEmailConfig(env: Record<string, string | undefined> = process.env): FounderEmailConfig {
  const apiKey = env.RESEND_API_KEY ?? "";
  const address = env.FOUNDER_EMAIL_FROM || FOUNDER_ADDRESS;
  const days = Number(env.FOUNDER_EMAIL_MAX_AGE_DAYS);
  return {
    enabled: env.FOUNDER_EMAIL_ENABLED === "true" && Boolean(apiKey),
    apiKey,
    // The display name has a comma, so it must be quoted (RFC 5322).
    from: `"${FOUNDER_FROM_NAME}" <${address}>`,
    replyTo: env.FOUNDER_EMAIL_REPLY_TO || FOUNDER_ADDRESS,
    maxAgeDays: Number.isFinite(days) && days > 0 ? days : 3,
  };
}

const isMissingTable = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || (/email_outbox/.test(e.message ?? "") && /exist|schema cache/.test(e.message ?? ""))));

/**
 * Record the welcome job for a user's first paid subscription. At most one per user, ever (unique
 * key), so duplicate webhooks, renewals and re-subscriptions are no-ops. Never throws.
 */
export async function enqueueFounderWelcome(admin: SupabaseClient, job: { userId: string; email: string | null; sourceRef: string }): Promise<"queued" | "exists" | "unavailable"> {
  try {
    const { data, error } = await admin
      .from("email_outbox")
      .upsert({ kind: "founder_welcome", user_id: job.userId, to_email: job.email, source_ref: job.sourceRef, status: "pending" }, { onConflict: "kind,user_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      if (!isMissingTable(error)) logError("email.enqueue", error, { user: job.userId });
      return "unavailable";
    }
    return data && data.length ? "queued" : "exists";
  } catch (e) {
    logError("email.enqueue", e, { user: job.userId });
    return "unavailable";
  }
}

type Row = { id: string; user_id: string; to_email: string | null; attempts: number; created_at: string };
type Fetch = typeof fetch;

async function sendViaResend(cfg: FounderEmailConfig, row: Row, to: string, fetchImpl: Fetch): Promise<{ ok: true; id: string | null } | { ok: false; retry: boolean; error: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8_000);
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
        // Resend drops a repeat of the same key, so a retry after a timeout can't send twice.
        "idempotency-key": `founder-welcome/${row.id}`,
      },
      body: JSON.stringify({ from: cfg.from, to: [to], reply_to: cfg.replyTo, subject: FOUNDER_SUBJECT, text: founderWelcomeText(), html: founderWelcomeHtml() }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok) return { ok: true, id: body.id ?? null };
    return { ok: false, retry: r.status === 429 || r.status >= 500, error: `${r.status} ${body.name ?? ""} ${body.message ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false, retry: true, error: String((e as Error).message ?? e).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

async function recipientFor(admin: SupabaseClient, row: Row): Promise<string | null> {
  if (row.to_email) return row.to_email;
  try {
    const { data } = await admin.auth.admin.getUserById(row.user_id);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Deliver waiting welcome emails (all, or just `ids`). Safe to run concurrently: each job is claimed
 * with a conditional update before sending. Returns counts only (no customer details).
 */
export async function deliverFounderEmails(admin: SupabaseClient, opts: { ids?: string[]; limit?: number; config?: FounderEmailConfig; fetchImpl?: Fetch; now?: Date } = {}) {
  const cfg = opts.config ?? founderEmailConfig();
  const out = { sent: 0, failed: 0, skipped: 0, disabled: !cfg.enabled };
  if (!cfg.enabled) return out;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - cfg.maxAgeDays * 86_400_000).toISOString();

  // Too old to feel personal: skip rather than send days late.
  await admin.from("email_outbox").update({ status: "skipped", last_error: "expired before sending", to_email: null, updated_at: now.toISOString() })
    .eq("kind", "founder_welcome").in("status", ["pending", "failed"]).lt("created_at", cutoff);

  // A worker that stopped mid-send leaves its claim behind; release it after the lock expires.
  // (Resend's idempotency key stops a duplicate if that send actually went out.)
  await admin.from("email_outbox").update({ status: "failed", locked_until: null, last_error: "interrupted", updated_at: now.toISOString() })
    .eq("kind", "founder_welcome").eq("status", "sending").lt("locked_until", now.toISOString());

  let q = admin.from("email_outbox").select("id,user_id,to_email,attempts,created_at")
    .eq("kind", "founder_welcome").in("status", ["pending", "failed"]).lt("attempts", MAX_ATTEMPTS).gte("created_at", cutoff)
    .order("created_at", { ascending: true }).limit(opts.limit ?? 20);
  if (opts.ids?.length) q = q.in("id", opts.ids);
  const { data: rows, error } = await q;
  if (error) { if (!isMissingTable(error)) logError("email.deliver", error); return out; }

  for (const row of (rows ?? []) as Row[]) {
    const lockUntil = new Date(now.getTime() + 60_000).toISOString();
    const { data: claimed } = await admin.from("email_outbox")
      .update({ status: "sending", attempts: row.attempts + 1, locked_until: lockUntil, updated_at: now.toISOString() })
      .eq("id", row.id).in("status", ["pending", "failed"]).eq("attempts", row.attempts)
      .select("id");
    if (!claimed?.length) continue; // another worker has it

    const to = await recipientFor(admin, row);
    if (!to) {
      await admin.from("email_outbox").update({ status: "skipped", last_error: "no email address on the account", locked_until: null, updated_at: new Date().toISOString() }).eq("id", row.id);
      out.skipped++;
      continue;
    }
    const res = await sendViaResend(cfg, row, to, opts.fetchImpl ?? fetch);
    if (res.ok) {
      await admin.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: res.id, to_email: null, last_error: null, locked_until: null, updated_at: new Date().toISOString() }).eq("id", row.id);
      out.sent++;
    } else {
      const final = !res.retry || row.attempts + 1 >= MAX_ATTEMPTS;
      await admin.from("email_outbox").update({ status: final ? "skipped" : "failed", last_error: res.error, locked_until: null, ...(final ? { to_email: null } : {}), updated_at: new Date().toISOString() }).eq("id", row.id);
      logError("email.send", new Error(res.error), { job: row.id, final });
      out.failed++;
    }
  }
  return out;
}
