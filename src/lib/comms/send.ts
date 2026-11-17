import "server-only";
import { randomUUID } from "node:crypto";

/** Customer email through Resend (the provider already used for Built2Bid email). */
export interface CommEmail {
  idempotencyKey: string; from: string; to: string; replyTo: string | null; subject: string; text: string;
  messageId: string; unsubscribe?: { oneClick: string } | null; tags?: { name: string; value: string }[];
}
export type SendResult = { ok: true; id: string | null } | { ok: false; retry: boolean; error: string };

export const newRfcMessageId = (domain = "built2bid.org") => `<comm-${randomUUID()}@${domain}>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function textToHtml(text: string): string {
  const linked = esc(text).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1b1f24;white-space:pre-wrap">${linked}</div>`;
}

/** Display-name safe: the contractor's company, quoted (RFC 5322). */
export function fromHeader(name: string, address: string): string {
  const clean = name.replace(/["\\\r\n<>]/g, "").trim().slice(0, 80) || "Your contractor";
  return `"${clean}" <${address}>`;
}

export async function sendCommEmail(apiKey: string, m: CommEmail, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const headers: Record<string, string> = { "Message-ID": m.messageId };
  if (m.unsubscribe) { headers["List-Unsubscribe"] = `<${m.unsubscribe.oneClick}>`; headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"; }
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": m.idempotencyKey },
      body: JSON.stringify({ from: m.from, to: [m.to], reply_to: m.replyTo ?? undefined, subject: m.subject, text: m.text, html: textToHtml(m.text), headers, tags: m.tags }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok) return { ok: true, id: body.id ?? null };
    return { ok: false, retry: r.status === 429 || r.status >= 500, error: `${r.status} ${body.name ?? ""} ${body.message ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false, retry: true, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}
