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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The HTML version: the link is a button (with the full address under it as a fallback for email apps that
 * block buttons). The plain-text version keeps the bare link.
 */
export function inviteHtml(firstName: string, link: string, expires: string): string {
  const p = (t: string) => `<p style="margin:0 0 16px">${t}</p>`;
  const href = esc(link);
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#1a2433;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55"><div style="max-width:560px">`
    + p(`Hi ${esc(firstName)},`)
    + p("You&#39;re invited to the Built2Bid sales team. Tap the button and sign in with this email address; we&#39;ll email you a code, no password needed.")
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:#0d2a45">`
    + `<a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">Join the sales team</a>`
    + `</td></tr></table>`
    + `<p style="margin:0 0 16px;font-size:13px;color:#5b6878">Button not working? Copy this link into your browser:<br><a href="${href}" style="color:#0d2a45;word-break:break-all">${href}</a></p>`
    + p(`The link works until ${esc(expires)}. If you weren&#39;t expecting this, you can ignore it.`)
    + p("James<br>Built2Bid")
    + `</div></body></html>`;
}

export function inviteText(firstName: string, link: string, expires: string): { subject: string; body: string; html: string } {
  return {
    html: inviteHtml(firstName, link, expires),
    subject: "Your Built2Bid sales team invitation",
    body: `Hi ${firstName},

You're invited to the Built2Bid sales team. Open this link and sign in with this email address; we'll email you a code, no password needed:

${link}

The link works until ${expires}. If you weren't expecting this, you can ignore it.

James
Built2Bid`,
  };
}

export async function sendInviteEmail(msg: { inviteId: string; to: string; subject: string; body: string; html?: string }, env: Record<string, string | undefined> = process.env, fetchImpl: Fetch = fetch):
  Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const cfg = founderEmailConfig(env);
  if (!inviteEmailsOn(env)) return { ok: false, error: "Invitation emails are off." };
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      // One key per invite row: a retry or double click can't send the same invite twice.
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "idempotency-key": `sales-invite/${msg.inviteId}` },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], reply_to: cfg.replyTo, subject: msg.subject, text: msg.body + "\n", html: msg.html ?? congratsHtml(msg.body) }),
    });
    const b = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok) return { ok: true, id: b.id ?? null };
    return { ok: false, error: `${r.status} ${b.name ?? ""} ${b.message ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}
