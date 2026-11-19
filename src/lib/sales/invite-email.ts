/**
 * Rep invitation email (V8.6). Off unless SALES_INVITE_EMAILS=on and the founder sender is configured
 * (FOUNDER_EMAIL_ENABLED + RESEND_API_KEY). While off, the admin copies the link and sends it themselves.
 * A successful send means the provider ACCEPTED it; delivery or a bounce only comes from Resend's webhook.
 */
import { founderEmailConfig } from "@/lib/email/outbox";
import { congratsHtml, type Fetch } from "./congrats-email";

export function inviteEmailsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.SALES_INVITE_EMAILS === "on" && founderEmailConfig(env).enabled;
}

export function inviteText(firstName: string, link: string, expires: string): { subject: string; body: string } {
  return {
    subject: "Your Built2Bid sales team invitation",
    body: `Hi ${firstName},

You're invited to the Built2Bid sales team. Open this link and sign in with this email address; we'll email you a code, no password needed:

${link}

The link works until ${expires}. If you weren't expecting this, you can ignore it.

James
Built2Bid`,
  };
}

export async function sendInviteEmail(msg: { inviteId: string; to: string; subject: string; body: string }, env: Record<string, string | undefined> = process.env, fetchImpl: Fetch = fetch):
  Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const cfg = founderEmailConfig(env);
  if (!inviteEmailsOn(env)) return { ok: false, error: "Invitation emails are off." };
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      // One key per invite row: a retry or double click can't send the same invite twice.
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "idempotency-key": `sales-invite/${msg.inviteId}` },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], reply_to: cfg.replyTo, subject: msg.subject, text: msg.body + "\n", html: congratsHtml(msg.body) }),
    });
    const b = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok) return { ok: true, id: b.id ?? null };
    return { ok: false, error: `${r.status} ${b.name ?? ""} ${b.message ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}
