/**
 * Outreach message rendering. Initial emails are the owner-approved personalized drafts (written from
 * real research). Follow-ups use ONLY the follow-up template the owner approved. Every email gets the
 * CAN-SPAM footer: sender identity, a valid postal address, and a working opt-out.
 */
export interface OutreachSettings {
  sending_enabled: boolean;
  approved_by: string | null;
  approved_at: string | null;
  follow_up_subject: string;
  follow_up_body: string | null;
  follow_up_approved_at: string | null;
  follow_up_hours: number;
  daily_send_limit: number;
  business_hour_start: number;
  business_hour_end: number;
  sender_name: string | null;
  sender_email: string | null;
  reply_to: string | null;
  postal_address: string | null;
  cohort_label: string | null;
  cohort_deadline_is_real: boolean;
}

/**
 * Default follow-up (the addendum's template). The deadline sentence is kept ONLY when the owner has
 * marked the cohort deadline as a real enrollment schedule; otherwise it's removed (no manufactured scarcity).
 */
export const DEFAULT_FOLLOW_UP_BODY = `Hi [First Name],

Just wanted to follow up and make sure you saw my previous email!

We're currently selecting a small group of construction educators to receive a complimentary year of Built2Bid Team, along with [5/10] one-year subscriptions they can gift to their subscribers.

I think there's a great opportunity to use the platform to teach your community about estimating, project pricing, margins, and managing their bids.

[DEADLINE]We're hoping to finalize this first group by the end of the week. If the timing isn't right, no worries at all — we'll extend the opportunity to another creator.[/DEADLINE]

Would this be something you'd be interested in exploring?

Best,
[Sender Name]`;

export interface RenderContext { firstName: string | null; giftTier: number; originalSubject: string; senderName: string; deadlineIsReal: boolean }

export function renderFollowUp(subjectTpl: string, bodyTpl: string, ctx: RenderContext): { subject: string; body: string } {
  const fill = (s: string) => s
    .replace(/\[First Name\]/g, ctx.firstName?.trim() || "there")
    .replace(/\[5\/10\]/g, String(ctx.giftTier))
    .replace(/\[original subject\]/gi, ctx.originalSubject.replace(/^re:\s*/i, ""))
    .replace(/\[Sender Name\]|\[Verified sender\]/gi, ctx.senderName);
  let body = bodyTpl.replace(/\[DEADLINE\]([\s\S]*?)\[\/DEADLINE\]\n?\n?/g, (_m, inner: string) => (ctx.deadlineIsReal ? `${inner}\n\n` : ""));
  body = fill(body).replace(/\n{3,}/g, "\n\n").trim();
  const subject = fill(subjectTpl).slice(0, 200);
  return { subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, body };
}

export function footer(s: Pick<OutreachSettings, "sender_name" | "postal_address">, unsubscribeUrl: string): string {
  return `\n\n--\n${s.sender_name ?? "Built2Bid"}\nBuilt2Bid.org\n${s.postal_address ?? ""}\nIf you'd rather not hear from us, unsubscribe here: ${unsubscribeUrl}\n(or just reply "no thanks").`;
}

/** Placeholders that must never go out. */
export function unresolvedPlaceholders(text: string): string[] {
  return [...new Set((text.match(/\[(?:[A-Z][A-Za-z0-9 /'.,:-]{1,80}|5\/10|original subject|\/DEADLINE)\]/g) ?? []))];
}

/** Everything that must be true before ANY email is sent. Empty list = ready. */
export function sendingBlockers(s: OutreachSettings | null, env: { enabled: boolean; hasKey: boolean; hasUnsubscribeSecret: boolean }): string[] {
  const out: string[] = [];
  if (!env.enabled) out.push("Server switch CREATOR_OUTREACH_SEND_ENABLED is not \"true\".");
  if (!env.hasKey) out.push("No email provider key (RESEND_API_KEY).");
  if (!env.hasUnsubscribeSecret) out.push("CREATOR_OUTREACH_SECRET is not set (needed for unsubscribe links and the scheduler).");
  if (!s) return [...out, "Outreach settings are missing (run the migration)."];
  if (!s.sending_enabled || !s.approved_at) out.push("The owner has not approved and switched on the sending workflow.");
  if (!s.sender_email || !s.sender_name) out.push("Verified sender name and email are not set.");
  if (!s.postal_address || s.postal_address.trim().length < 10) out.push("A valid postal address (CAN-SPAM) is not set.");
  return out;
}
