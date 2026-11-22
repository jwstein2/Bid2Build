import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";
import { inDemoSession } from "@/lib/demo/guard";
import { commConfig } from "@/lib/comms/config";
import { fromHeader, textToHtml } from "@/lib/comms/send";
import { newReplyToken, replyAddress } from "@/lib/comms/tokens";
import { site } from "@/lib/site";
import { buildCtx, footer, planFollowUp, renderKey, unresolved, type CampaignKind, type Milestones } from "./templates";
import { bookingRef, unsubscribeToken } from "./tokens";

/**
 * Sends follow-up and nurture emails through Resend (the app's existing email provider). Every send
 * re-checks, immediately before it goes out: the campaign is still active, the lead didn't opt out or
 * change address, the address isn't suppressed or bounced, the rep is still active, test mode only
 * reaches test addresses, and (for follow-ups) the lead's CURRENT verified milestones. Follow-up text
 * is rendered only at that moment. Delivery uses an idempotency key per message, so a retry after a
 * timeout can't send twice.
 *
 * Kill switch: SALES_NURTURE_DISABLED=true stops all sending regardless of the admin settings.
 */
type Db = SupabaseClient;
type Row = Record<string, unknown>;

/** A rep's sending mailbox must be on built2bid.org. */
export const isBuilt2BidAddress = (e: string | null | undefined): e is string => /^[a-z0-9._+-]+@built2bid\.org$/.test(e ?? "");

export interface SendContext {
  message: { id: string; step: 0 | 1 | 2; status: string; attempts: number; subject: string | null; body: string | null };
  campaign: { id: string; kind: CampaignKind; status: string; to_email: string; first_subject: string | null; first_rfc_message_id: string | null; sent_templates: string[] };
  lead: { id: string; company_name: string; contact_name: string | null; email: string | null; state: string | null; trades: string[]; stage: string; do_not_contact: boolean; email_status: string | null; email_opt_out_at: string | null; assigned_rep: string | null };
  rep: { id: string; full_name: string; email: string; phone: string | null; code: string; status: string; booking_slug: string | null; from_email: string | null };
  milestones: Milestones & Row;
  suppressed: string | null;
  settings: { send_mode: "off" | "test" | "live"; test_recipients: string[]; postal_address: string | null; paused: boolean; blockers: string[] };
}

export type Decision =
  | { action: "send"; key: string; subject: string; body: string; milestone: string }
  | { action: "skip"; reason: string; endStatus?: string }
  /** Not now (sending switched off mid-run): try again later without ending the campaign. */
  | { action: "wait"; reason: string };

/** Everything decided before a send, without I/O (unit tested). */
export function decide(ctx: SendContext, origin = site.url): Decision {
  const { message: m, campaign: c, lead: l, rep, settings: s } = ctx;
  if (s.blockers.length || s.paused || s.send_mode === "off") return { action: "wait", reason: "sending is off or paused" };
  if (c.status !== "active") return { action: "skip", reason: `campaign is ${c.status}` };
  if (l.do_not_contact || l.email_opt_out_at) return { action: "skip", reason: "lead opted out", endStatus: "unsubscribed" };
  if (ctx.suppressed) return { action: "skip", reason: `address ${ctx.suppressed}`, endStatus: ctx.suppressed === "bounced" ? "failed_delivery" : "unsubscribed" };
  if (l.email_status === "bounced" || l.email_status === "undeliverable") return { action: "skip", reason: "address can't receive mail", endStatus: "failed_delivery" };
  if ((l.email ?? "").toLowerCase() !== c.to_email) return { action: "skip", reason: "the lead's email changed", endStatus: "stopped" };
  if (l.assigned_rep !== rep.id) return { action: "skip", reason: "the lead moved to another rep", endStatus: "stopped" };
  if (rep.status !== "active") return { action: "skip", reason: "the rep is no longer active", endStatus: "stopped" };
  if (l.stage === "paying") return { action: "skip", reason: "already a paying customer", endStatus: "converted" };
  if (l.stage === "lost") return { action: "skip", reason: "marked not interested", endStatus: "not_interested" };
  if (s.send_mode === "test" && !s.test_recipients.map((x) => x.toLowerCase()).includes(c.to_email)) return { action: "skip", reason: "test mode: not a test address", endStatus: "stopped" };
  // Only from the rep's own @built2bid.org mailbox. None assigned: hold until an admin assigns one.
  if (!isBuilt2BidAddress(rep.from_email)) return { action: "wait", reason: "no @built2bid.org sending address assigned to the rep" };
  const top = String(ctx.milestones?.top ?? "none");
  if (m.step === 0) {
    if (!m.subject || !m.body) return { action: "skip", reason: "first email is empty", endStatus: "stopped" };
    if (ctx.milestones?.paid) return { action: "skip", reason: "already a paying customer", endStatus: "converted" };
    return { action: "send", key: `${c.kind}_initial`, subject: m.subject, body: m.body, milestone: top };
  }
  const plan = planFollowUp(c.kind, m.step, ctx.milestones);
  if (plan.action === "stop") return { action: "skip", reason: plan.reason, endStatus: plan.status };
  // Never repeat an email already sent in this campaign.
  if (c.sent_templates.includes(plan.key)) return { action: "skip", reason: "that email was already sent", endStatus: m.step === 2 ? "completed" : undefined };
  const ctxT = buildCtx({ contactName: l.contact_name, companyName: l.company_name, trades: l.trades, rep, origin, scheduleRef: safeRef(c.id) });
  const r = renderKey(plan.key, ctxT);
  if (unresolved(`${r.subject}\n${r.body}`).length) return { action: "skip", reason: "unfilled placeholder", endStatus: "stopped" };
  return { action: "send", key: r.key, subject: r.subject, body: r.body, milestone: top };
}

function safeRef(id: string): string | null {
  try { return bookingRef(id); } catch { return null; }
}

export interface Outgoing { idempotencyKey: string; from: string; to: string; replyTo: string; subject: string; text: string; messageId: string; inReplyTo: string | null; unsubscribeOneClick: string }

export async function sendEmail(apiKey: string, m: Outgoing, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; id: string | null } | { ok: false; retry: boolean; error: string }> {
  // Demo / Practice Mode never emails anyone.
  if (await inDemoSession()) return { ok: false, retry: false, error: "demo_mode_no_send" };
  const headers: Record<string, string> = { "Message-ID": m.messageId, "List-Unsubscribe": `<${m.unsubscribeOneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if (m.inReplyTo) { headers["In-Reply-To"] = m.inReplyTo; headers.References = m.inReplyTo; }
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": m.idempotencyKey },
      body: JSON.stringify({ from: m.from, to: [m.to], reply_to: m.replyTo, subject: m.subject, text: m.text, html: textToHtml(m.text), headers, tags: [{ name: "kind", value: "sales_nurture" }] }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok) return { ok: true, id: body.id ?? null };
    return { ok: false, retry: r.status === 429 || r.status >= 500, error: `${r.status} ${body.name ?? ""} ${body.message ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false, retry: true, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}

/** Reply routing is used only when it is set up AND proven by a real test message (same rule as customer comms). */
async function replyDomain(db: Db): Promise<string | null> {
  const cfg = commConfig();
  if (!cfg.replyDomain || !cfg.webhookSecret) return null;
  const { data } = await db.from("comm_global").select("inbound_verified_at").eq("id", 1).maybeSingle();
  return (data as { inbound_verified_at?: string | null } | null)?.inbound_verified_at ? cfg.replyDomain : null;
}

export interface DeliverOpts { fetchImpl?: typeof fetch; apiKey?: string; origin?: string; replyDomain?: string | null; now?: Date }

/** Send one claimed message and record the outcome. */
export async function deliver(db: Db, ctx: SendContext, opts: DeliverOpts = {}): Promise<"sent" | "skipped" | "retry" | "failed"> {
  const origin = opts.origin ?? site.url;
  const d = decide(ctx, origin);
  const mark = (outcome: string, p: Row) => db.rpc("sales_campaign_mark", { p_message: ctx.message.id, p_outcome: outcome, p, ...(opts.now ? { p_now: opts.now.toISOString() } : {}) });
  if (d.action === "wait") { await mark("retry", { error: d.reason }); return "retry"; }
  if (d.action === "skip") {
    await mark("skipped", { reason: d.reason, end_status: d.endStatus ?? null });
    return "skipped";
  }
  const apiKey = opts.apiKey ?? process.env.RESEND_API_KEY ?? "";
  if (!apiKey || process.env.SALES_NURTURE_DISABLED === "true") { await mark("retry", { error: "email provider not configured" }); return "retry"; }
  const domain = opts.replyDomain === undefined ? await replyDomain(db) : opts.replyDomain;
  const token = domain ? newReplyToken() : null;
  const unsub = new URL(`/unsubscribe/sales?t=${encodeURIComponent(unsubscribeToken(ctx.campaign.to_email))}`, origin).toString();
  const oneClick = new URL(`/api/sales/unsubscribe?t=${encodeURIComponent(unsubscribeToken(ctx.campaign.to_email))}`, origin).toString();
  const text = d.body + footer({ companyName: ctx.lead.company_name, postalAddress: ctx.settings.postal_address ?? "", unsubscribeUrl: unsub, repFirstName: ctx.rep.full_name.split(/\s+/)[0] });
  const messageId = `<sales-${randomUUID()}@built2bid.org>`;
  const res = await sendEmail(apiKey, {
    idempotencyKey: `sales-nurture/${ctx.message.id}`, from: fromHeader(`${ctx.rep.full_name} at Built2Bid`, ctx.rep.from_email!), to: ctx.campaign.to_email,
    replyTo: token && domain ? replyAddress(token, domain) : ctx.rep.from_email!, subject: d.subject, text, messageId,
    inReplyTo: ctx.message.step > 0 ? ctx.campaign.first_rfc_message_id : null, unsubscribeOneClick: oneClick,
  }, opts.fetchImpl);
  if (res.ok) {
    await mark("sent", { subject: d.subject, body: d.body, template_key: d.key, milestone: d.milestone, provider_id: res.id, rfc_message_id: messageId, reply_token: token });
    return "sent";
  }
  logError("sales_nurture.send", new Error(res.error), { message: ctx.message.id, retry: res.retry });
  await mark(res.retry ? "retry" : "failed", { error: res.error });
  return res.retry ? "retry" : "failed";
}

/** Send the rep's first email right away (called after they click Send). */
export async function sendFirstEmail(db: Db, messageId: string, opts: DeliverOpts = {}): Promise<"sent" | "skipped" | "retry" | "failed" | "not_claimed"> {
  const { data, error } = await db.rpc("sales_campaign_claim_one", { p_message: messageId });
  if (error || !data) return "not_claimed";
  return deliver(db, data as SendContext, opts);
}

export interface RunResult { blocked: boolean; reason?: string; sent: number; skipped: number; retry: number; failed: number }

/** The scheduled run (every 15 minutes): claim due follow-ups and send them. */
export async function runSalesNurture(db: Db, opts: DeliverOpts & { limit?: number } = {}): Promise<RunResult> {
  const out: RunResult = { blocked: false, sent: 0, skipped: 0, retry: 0, failed: 0 };
  if (process.env.SALES_NURTURE_DISABLED === "true") return { ...out, blocked: true, reason: "SALES_NURTURE_DISABLED" };
  const now = opts.now ?? new Date();
  const { data, error } = await db.rpc("sales_campaign_claim", { p_now: now.toISOString(), p_limit: opts.limit ?? 20 });
  if (error) {
    if (/sales_campaign_claim/.test(error.message ?? "")) return { ...out, blocked: true, reason: "not_installed" };
    throw error;
  }
  const r = data as { blocked: boolean; blockers?: string[]; paused?: boolean; messages: SendContext[] };
  if (r.blocked) return { ...out, blocked: true, reason: r.paused ? "paused" : (r.blockers ?? []).join(",") };
  const domain = opts.replyDomain === undefined ? await replyDomain(db) : opts.replyDomain;
  for (const ctx of r.messages) {
    try { out[await deliver(db, ctx, { ...opts, replyDomain: domain })]++; }
    catch (e) { logError("sales_nurture.deliver", e, { message: ctx.message.id }); out.failed++; }
  }
  return out;
}
