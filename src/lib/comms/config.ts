import "server-only";
/**
 * Customer communications sending configuration. OFF unless COMM_EMAIL_MODE is test or live.
 *
 *   COMM_EMAIL_MODE          off (default) | test (only COMM_TEST_RECIPIENTS can receive) | live
 *   COMM_RESEND_API_KEY      optional separate Resend key (falls back to RESEND_API_KEY). A separate key
 *                            keeps contractor email isolated from sign-in codes and account email.
 *   COMM_EMAIL_FROM          sending address (default updates@built2bid.org); display name = contractor
 *   COMM_REPLY_DOMAIN        receiving domain for reply routing, e.g. reply.built2bid.org (MX -> Resend)
 *   RESEND_WEBHOOK_SECRET    signing secret for /api/webhooks/resend (delivered / bounced / complained / received)
 *   COMM_INBOUND_SECRET      optional shared secret for /api/webhooks/comms-inbound (other forwarders)
 *   COMM_TEST_RECIPIENTS     comma-separated addresses allowed in test mode
 *   COMM_DAILY_CAP           max customer emails per UTC day across all accounts (default 300)
 *   COMM_ACCOUNT_DAILY_CAP   max per account per day (default 60)
 */
type Env = Record<string, string | undefined>;
export type CommMode = "off" | "test" | "live";

export interface CommConfig {
  mode: CommMode; enabled: boolean; reason: string | null; apiKey: string; fromAddress: string; replyDomain: string | null;
  webhookSecret: string; inboundSecret: string; testRecipients: string[]; dailyCap: number; accountDailyCap: number;
}

export function commConfig(env: Env = process.env): CommConfig {
  const m = (env.COMM_EMAIL_MODE ?? "off").trim().toLowerCase();
  const mode: CommMode = m === "test" || m === "live" ? m : "off";
  const apiKey = env.COMM_RESEND_API_KEY || env.RESEND_API_KEY || "";
  const testRecipients = (env.COMM_TEST_RECIPIENTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));
  const n = (v: string | undefined, d: number) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), 5000) : d);
  const reason = mode === "off" ? "Customer email sending is switched off (COMM_EMAIL_MODE)."
    : !apiKey ? "No email provider key is set."
      : mode === "test" && !testRecipients.length ? "Test mode needs COMM_TEST_RECIPIENTS."
        : null;
  const domain = (env.COMM_REPLY_DOMAIN ?? "").trim().toLowerCase();
  return {
    mode, enabled: reason === null, reason, apiKey,
    fromAddress: env.COMM_EMAIL_FROM || "updates@built2bid.org",
    replyDomain: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null,
    webhookSecret: env.RESEND_WEBHOOK_SECRET ?? "", inboundSecret: env.COMM_INBOUND_SECRET ?? "",
    testRecipients, dailyCap: n(env.COMM_DAILY_CAP, 300), accountDailyCap: n(env.COMM_ACCOUNT_DAILY_CAP, 60),
  };
}

export interface ReplyMonitoring { configured: boolean; active: boolean; reason: string | null; verifiedAt: string | null }

/**
 * Reply monitoring is "active" only when replies are routed to a receiving domain, the webhook is
 * authenticated, AND a real test message has arrived through it. Nothing else may claim it's on.
 */
export function replyMonitoring(cfg: CommConfig, verifiedAt: string | null): ReplyMonitoring {
  if (!cfg.replyDomain) return { configured: false, active: false, reason: "Replies aren't routed to Built2Bid yet (no receiving domain).", verifiedAt: null };
  if (!cfg.webhookSecret && !cfg.inboundSecret) return { configured: false, active: false, reason: "The inbound email webhook isn't secured yet.", verifiedAt: null };
  if (!verifiedAt) return { configured: true, active: false, reason: "Waiting for a test reply to arrive.", verifiedAt: null };
  return { configured: true, active: true, reason: null, verifiedAt };
}
