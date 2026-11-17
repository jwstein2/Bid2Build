import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { commConfig } from "@/lib/comms/config";
import { processInbound } from "@/lib/comms/inbound";
import { logEvent, suppress } from "@/lib/comms/server";
import { verifySvix } from "@/lib/comms/svix";

export const runtime = "nodejs";
export const maxDuration = 30;

type Row = Record<string, unknown>;

/**
 * Resend webhook (signed with RESEND_WEBHOOK_SECRET). Handles customer communications only:
 *   email.delivered   -> message Delivered (only a provider delivery event can say this)
 *   email.bounced     -> hard bounces suppress the address for everyone; soft bounces are logged
 *   email.complained  -> spam complaint: suppress all email to that address from that contractor
 *   email.received    -> a reply arrived at reply+<token>@COMM_REPLY_DOMAIN: fetch the body, then pause/opt out
 * Each event is processed once (svix-id). Unknown messages are acknowledged and ignored.
 */
export async function POST(req: Request) {
  const cfg = commConfig();
  const raw = await req.text();
  if (!verifySvix(cfg.webhookSecret, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, raw)) return fail(401, "unauthorized", "Bad signature.");
  let evt: { type?: string; data?: Row };
  try { evt = JSON.parse(raw); } catch { return fail(400, "invalid", "Bad JSON."); }
  const admin = createAdminClient();
  const eventId = `resend:${req.headers.get("svix-id")}`;
  const d = evt.data ?? {};
  try {
    if (evt.type === "email.received") {
      const emailId = String(d.email_id ?? d.id ?? "");
      let body: Row = d;
      // The event carries headers only; the text comes from the Receiving API.
      if (emailId && cfg.apiKey && !d.text) {
        const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (r?.ok) body = { ...d, ...((await r.json().catch(() => ({}))) as Row) };
      }
      const headers = (body.headers ?? {}) as Record<string, string>;
      const hv = (k: string) => (Array.isArray(headers) ? (headers as { name: string; value: string }[]).find((h) => h.name.toLowerCase() === k)?.value : headers[k] ?? headers[k.toLowerCase()]) ?? null;
      const to = ([] as unknown[]).concat(body.to ?? []).map(String);
      const res = await processInbound(admin, cfg, {
        from: String(body.from ?? ""), to, subject: String(body.subject ?? ""), text: String(body.text ?? ""),
        inReplyTo: (body.in_reply_to as string) ?? hv("in-reply-to"), references: (body.references as string) ?? hv("references"), providerEventId: eventId,
      });
      return json(res);
    }
    const providerId = String(d.email_id ?? "");
    const { data: m } = providerId ? await admin.from("comm_messages").select("id, account_id, to_email, status").eq("provider_id", providerId).maybeSingle() : { data: null };
    const msg = m as Row | null;
    if (!msg) return json({ matched: false });
    const fresh = await logEvent(admin, { accountId: String(msg.account_id), messageId: String(msg.id), kind: evt.type === "email.delivered" ? "delivered" : evt.type === "email.complained" ? "complaint" : "bounce", details: { type: evt.type, bounce: d.bounce ?? null }, providerEventId: eventId });
    if (!fresh) return json({ duplicate: true });
    const to = String(msg.to_email ?? "");
    if (evt.type === "email.delivered") {
      await admin.from("comm_messages").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", String(msg.id)).eq("status", "sent");
    } else if (evt.type === "email.bounced") {
      const type = String((d.bounce as Row | undefined)?.type ?? "").toLowerCase();
      const hard = !type || type.includes("permanent") || type.includes("hard");
      await admin.from("comm_messages").update({ status: "failed", status_reason: hard ? "Bounced: address doesn't accept email" : "Temporarily undeliverable", attempts: 5 }).eq("id", String(msg.id));
      if (hard && to) await suppress(admin, { accountId: null, email: to, scope: "all", reason: "bounce", source: "provider bounce", messageId: String(msg.id) });
    } else if (evt.type === "email.complained" && to) {
      await suppress(admin, { accountId: String(msg.account_id), email: to, scope: "all", reason: "complaint", source: "spam complaint", messageId: String(msg.id) });
    }
    return json({ ok: true });
  } catch (e) {
    logError("comms.webhook", e, { type: evt.type });
    return fail(500, "failed", "Could not process.");
  }
}
