/**
 * Owner congratulations email (V8.4). Pure helpers, kept apart from delivery so they can be tested.
 * Delivery uses the founder sender already verified in Resend (FOUNDER_EMAIL_FROM, default
 * james@built2bid.org) and never any other mailbox.
 */
export type Fetch = typeof fetch;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function congratsHtml(body: string): string {
  const paras = body.trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 16px">${esc(p).replace(/\n/g, "<br>")}</p>`);
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#1a2433;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55"><div style="max-width:560px">${paras.join("")}</div></body></html>`;
}

export interface CongratsSender { enabled: boolean; apiKey: string; from: string; replyTo: string }

export async function sendCongrats(cfg: CongratsSender, msg: { id: string; to: string; subject: string; body: string }, fetchImpl: Fetch = fetch):
  Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (!cfg.enabled) return { ok: false, error: "Email sending isn't configured (FOUNDER_EMAIL_ENABLED and RESEND_API_KEY)." };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8_000);
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
        // One key per congratulations row: a retry or double click can't send it twice.
        "idempotency-key": `sales-congrats/${msg.id}`,
      },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], reply_to: cfg.replyTo, subject: msg.subject, text: msg.body.trim() + "\n", html: congratsHtml(msg.body) }),
    });
    const b = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok) return { ok: true, id: b.id ?? null };
    return { ok: false, error: `${r.status} ${b.name ?? ""} ${b.message ?? ""}`.trim().slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}
