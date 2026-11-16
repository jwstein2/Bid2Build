import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Creator outreach email delivery through Resend (the provider already used for the founder email).
 * OFF unless CREATOR_OUTREACH_SEND_ENABLED=true AND RESEND_API_KEY AND CREATOR_OUTREACH_SECRET are set,
 * and the owner has approved + switched on sending in Admin → Creator Partnerships → Settings.
 */
export interface OutreachEnv { enabled: boolean; apiKey: string; secret: string; siteUrl: string }

export function outreachEnv(env: Record<string, string | undefined> = process.env, siteUrl = "https://built2bid.org"): OutreachEnv {
  return {
    enabled: env.CREATOR_OUTREACH_SEND_ENABLED === "true",
    apiKey: env.RESEND_API_KEY ?? "",
    secret: env.CREATOR_OUTREACH_SECRET ?? "",
    siteUrl,
  };
}

export interface OutgoingEmail {
  idempotencyKey: string;
  from: string;
  to: string;
  replyTo: string | null;
  subject: string;
  text: string;
  unsubscribeUrl: string;
  inReplyTo?: string | null;
}

export function newMessageId(domain = "built2bid.org"): string {
  return `<creator-${randomUUID()}@${domain}>`;
}

export async function sendOutreachEmail(apiKey: string, m: OutgoingEmail & { messageId: string }, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; id: string | null } | { ok: false; retry: boolean; error: string }> {
  const headers: Record<string, string> = {
    "Message-ID": m.messageId,
    "List-Unsubscribe": `<${m.unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  if (m.inReplyTo) { headers["In-Reply-To"] = m.inReplyTo; headers.References = m.inReplyTo; }
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": m.idempotencyKey },
      body: JSON.stringify({ from: m.from, to: [m.to], reply_to: m.replyTo ?? undefined, subject: m.subject, text: m.text, headers }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok) return { ok: true, id: body.id ?? null };
    return { ok: false, retry: r.status === 429 || r.status >= 500, error: `${r.status} ${body.name ?? ""} ${body.message ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false, retry: true, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}
