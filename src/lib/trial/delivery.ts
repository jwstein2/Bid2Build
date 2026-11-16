import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { site } from "../site";
import { day2Email, day6Email, inviteEmail, type Rendered } from "./emails";
import { makeInviteToken, unsubscribeSig } from "./token";

/**
 * Trial email delivery through Resend (the provider already used for the founder email and sign-in
 * codes). Each email is a row in trial_campaign_emails; a row is claimed with a conditional update
 * before sending and Resend gets an idempotency key per row, so concurrent workers, retries after a
 * timeout and repeated cron runs never send the same email twice. Logs carry ids only.
 */
export const MAX_ATTEMPTS = 5;
type Fetch = typeof fetch;

export interface TrialEmailConfig { enabled: boolean; apiKey: string; from: string; replyTo: string }

export function trialEmailConfig(env: Record<string, string | undefined> = process.env): TrialEmailConfig {
  const apiKey = env.RESEND_API_KEY ?? "";
  return {
    enabled: env.FB_TRIAL_ENABLED === "true" && Boolean(apiKey),
    apiKey,
    from: env.TRIAL_EMAIL_FROM || "Built2Bid <hello@built2bid.org>",
    replyTo: env.TRIAL_EMAIL_REPLY_TO || "support@built2bid.org",
  };
}

export function activateUrl(token: string, origin = site.url): string {
  // Fragment, not query: never sent to the server, logs or analytics.
  return `${new URL("/trial/activate", origin).toString()}#t=${token}`;
}

export function unsubscribeUrl(inviteId: string, origin = site.url): string {
  const u = new URL("/trial/unsubscribe", origin);
  u.searchParams.set("i", inviteId);
  u.searchParams.set("s", unsubscribeSig(inviteId));
  return u.toString();
}

type Row = { id: string; invite_id: string; kind: "invite" | "day2" | "day6"; attempts: number };
type Invite = { id: string; email: string; status: string; token_version: number; invite_expires_at: string };

async function resend(cfg: TrialEmailConfig, rowId: string, to: string, mail: Rendered, unsub: string | null, fetchImpl: Fetch) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8_000);
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: ctl.signal,
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "idempotency-key": `trial-email/${rowId}` },
      body: JSON.stringify({
        from: cfg.from, to: [to], reply_to: cfg.replyTo, subject: mail.subject, text: mail.text, html: mail.html,
        ...(unsub ? { headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
      }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok) return { ok: true as const, id: body.id ?? null };
    return { ok: false as const, retry: r.status === 429 || r.status >= 500, error: `${r.status} ${body.name ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false as const, retry: true, error: String((e as Error).name ?? "error").slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

/** What to send for this row, or a reason to skip it. */
async function compose(db: SupabaseClient, row: Row, inv: Invite, now: Date): Promise<{ mail: Rendered; unsub: string | null } | { skip: string } | { wait: true }> {
  if (row.kind === "invite") {
    if (inv.status !== "pending") return { skip: "invite already used" };
    if (new Date(inv.invite_expires_at) <= now) return { skip: "invite expired" };
    return { mail: inviteEmail({ activateUrl: activateUrl(makeInviteToken(inv.id, inv.token_version)), inviteExpiresAt: inv.invite_expires_at }), unsub: null };
  }
  const { data, error } = await db.rpc("trial_checkin_context", { p_invite_id: inv.id });
  if (error || !data) return { wait: true };
  const c = data as { opted_in: boolean; grant_active: boolean; expires_at: string | null; finished_bid: boolean; paid: boolean; suppressed: boolean };
  if (!c.opted_in) return { skip: "no check-in consent" };
  if (c.suppressed) return { skip: "suppressed" };
  if (c.paid) return { skip: "converted" };
  if (!c.grant_active || !c.expires_at) return { skip: "trial not active" };
  const unsub = unsubscribeUrl(inv.id);
  if (row.kind === "day2") {
    if (c.finished_bid) return { skip: "already finished a bid" };
    return { mail: day2Email({ appUrl: new URL("/bids", site.url).toString(), unsubscribeUrl: unsub }), unsub };
  }
  return { mail: day6Email({ expiresAt: c.expires_at, billingUrl: new URL("/pricing", site.url).toString(), unsubscribeUrl: unsub }), unsub };
}

export async function deliverTrialEmails(db: SupabaseClient, opts: { ids?: string[]; limit?: number; config?: TrialEmailConfig; fetchImpl?: Fetch; now?: Date } = {}) {
  const cfg = opts.config ?? trialEmailConfig();
  const out = { sent: 0, failed: 0, skipped: 0, disabled: !cfg.enabled };
  if (!cfg.enabled) return out;
  const now = opts.now ?? new Date();
  const iso = now.toISOString();

  // A worker that died mid-send leaves a claim behind; release it once the lock expires.
  await db.from("trial_campaign_emails").update({ status: "failed", locked_until: null, last_error: "interrupted" })
    .eq("status", "sending").lt("locked_until", iso);

  let q = db.from("trial_campaign_emails").select("id, invite_id, kind, attempts")
    .in("status", ["pending", "failed"]).lt("attempts", MAX_ATTEMPTS);
  // An explicit id is "send this now" (the invite just queued); the scheduled run honours send_after.
  q = opts.ids?.length ? q.in("id", opts.ids) : q.lte("send_after", iso);
  q = q.order("send_after", { ascending: true }).limit(opts.limit ?? 25);
  const { data: rows, error } = await q;
  if (error) { logError("trial.email.list", error); return out; }

  for (const row of (rows ?? []) as Row[]) {
    const { data: claimed } = await db.from("trial_campaign_emails")
      .update({ status: "sending", attempts: row.attempts + 1, locked_until: new Date(now.getTime() + 60_000).toISOString() })
      .eq("id", row.id).in("status", ["pending", "failed"]).eq("attempts", row.attempts).select("id");
    if (!claimed?.length) continue;

    const { data: inv } = await db.from("trial_campaign_invites").select("id, email, status, token_version, invite_expires_at").eq("id", row.invite_id).maybeSingle();
    const plan = inv ? await compose(db, row, inv as Invite, now) : { skip: "invite missing" };
    if ("wait" in plan) {
      await db.from("trial_campaign_emails").update({ status: "failed", locked_until: null, last_error: "context unavailable" }).eq("id", row.id);
      out.failed++;
      continue;
    }
    if ("skip" in plan) {
      await db.from("trial_campaign_emails").update({ status: "skipped", locked_until: null, last_error: plan.skip }).eq("id", row.id);
      out.skipped++;
      continue;
    }
    const res = await resend(cfg, row.id, (inv as Invite).email, plan.mail, plan.unsub, opts.fetchImpl ?? fetch);
    if (res.ok) {
      await db.from("trial_campaign_emails").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: res.id, last_error: null, locked_until: null }).eq("id", row.id);
      out.sent++;
    } else {
      const final = !res.retry || row.attempts + 1 >= MAX_ATTEMPTS;
      await db.from("trial_campaign_emails").update({ status: final ? "skipped" : "failed", last_error: res.error, locked_until: null }).eq("id", row.id);
      logError("trial.email.send", new Error(res.error), { job: row.id, kind: row.kind, final });
      out.failed++;
    }
  }
  return out;
}
