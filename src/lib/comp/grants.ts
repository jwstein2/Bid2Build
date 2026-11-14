/**
 * Complimentary Access (platform owner admin). Pure definitions shared by the admin UI, server
 * actions and tests. Entitlement itself lives in Postgres (has_unlimited / active_comp_grant).
 */
import { z } from "zod";

export const COMP_PLANS = ["unlimited", "enterprise"] as const;
export type CompPlan = (typeof COMP_PLANS)[number];

export const COMP_PLAN_LABELS: Record<CompPlan, string> = {
  unlimited: "Unlimited (individual)",
  enterprise: "Enterprise (company)",
};

/** Licensed users a grant includes before any extra complimentary seats. */
export const INCLUDED_SEATS: Record<CompPlan, number> = { unlimited: 1, enterprise: 3 };

export const DURATION_PRESETS = [7, 14, 30, 60, 90] as const;
export const MAX_GRANT_DAYS = 365;
export const MAX_EXTRA_SEATS = 50;
/** How long an invitation link stays usable before an admin must resend it. */
export const INVITE_DAYS = 30;

export type CompState = "pending" | "invite_expired" | "scheduled" | "active" | "paused" | "expired" | "revoked";

export const STATE_LABELS: Record<CompState, string> = {
  pending: "Invitation pending",
  invite_expired: "Invitation expired",
  scheduled: "Scheduled",
  active: "Active",
  paused: "Paused",
  expired: "Expired",
  revoked: "Revoked",
};

export const STATE_TONES: Record<CompState, "neutral" | "ok" | "warn" | "danger" | "brand" | "accent"> = {
  pending: "accent",
  invite_expired: "warn",
  scheduled: "brand",
  active: "ok",
  paused: "warn",
  expired: "neutral",
  revoked: "danger",
};

/** Filter values for the management table ("expiring_soon" = active, ends within 7 days). */
export const STATE_FILTERS = ["active", "expiring_soon", "pending", "invite_expired", "paused", "expired", "revoked"] as const;

export const GrantInput = z.object({
  email: z.string().trim().toLowerCase().max(320).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address."),
  plan: z.enum(COMP_PLANS),
  days: z.coerce.number().int().min(1, "At least 1 day.").max(MAX_GRANT_DAYS, `At most ${MAX_GRANT_DAYS} days per grant.`),
  extraSeats: z.coerce.number().int().min(0).max(MAX_EXTRA_SEATS).default(0),
  /** Required (true) whenever extraSeats > 0: extra free seats need the owner's explicit sign-off. */
  approveExtraSeats: z.boolean().default(false),
  sendInvite: z.boolean().default(true),
  note: z.string().trim().max(500).optional(),
}).superRefine((v, ctx) => {
  if (v.plan === "unlimited" && v.extraSeats > 0) ctx.addIssue({ code: "custom", path: ["extraSeats"], message: "Extra seats only apply to Enterprise." });
  if (v.extraSeats > 0 && !v.approveExtraSeats) ctx.addIssue({ code: "custom", path: ["approveExtraSeats"], message: "Confirm you are authorizing the extra free seats." });
});
export type GrantInput = z.infer<typeof GrantInput>;

export const ExtendInput = z.object({ id: z.string().uuid(), days: z.coerce.number().int().min(1).max(MAX_GRANT_DAYS) });
export const SeatsInput = z.object({ id: z.string().uuid(), extraSeats: z.coerce.number().int().min(0).max(MAX_EXTRA_SEATS), approve: z.literal(true) });

/** Database error codes (raised by the admin_comp_* functions) -> admin-facing text. */
const ERRORS: Record<string, string> = {
  forbidden: "Only Built2Bid platform admins can do this.",
  invalid_email: "Enter a valid email address.",
  invalid_plan: "Choose Unlimited or Enterprise.",
  invalid_duration: `Choose between 1 and ${MAX_GRANT_DAYS} days.`,
  invalid_seats: `Extra seats must be 0 to ${MAX_EXTRA_SEATS}, and only on Enterprise grants.`,
  grant_exists: "This email already has an open complimentary grant. Extend that one instead.",
  rate_limited: "You've created 50 grants in the last 24 hours. Try again later.",
  not_found: "That grant no longer exists.",
  revoked: "That grant was revoked. Create a new grant instead.",
  too_long: "A grant can't run more than 730 days from today.",
  not_active: "Only an active grant can be paused.",
  not_paused: "That grant isn't paused.",
  not_pending: "That invitation was already accepted, so there's nothing to resend.",
  too_soon: "An invitation was just sent. Wait a minute before resending.",
  too_many_invites: "This invitation has been sent 10 times. Revoke it and create a new grant if needed.",
  invalid_token: "Could not create a secure invitation. Try again.",
};

export function compErrorMessage(raw: string | undefined | null): string {
  const key = (raw ?? "").trim();
  return ERRORS[key] ?? "Something went wrong. Nothing was changed.";
}

/** Claim results from claim_comp_grant_by_token -> recipient-facing text. */
export function claimMessage(reason: string | undefined, hint?: string): string {
  switch (reason) {
    case "email_mismatch": return `This invitation was sent to ${hint ?? "a different email"}. Sign in with that email address to accept it.`;
    case "email_unverified": return "Add and verify the email address the invitation was sent to (Settings → Account), then open the link again.";
    case "invite_expired": return "This invitation has expired. Ask the person who invited you to send a new one.";
    case "revoked": return "This invitation is no longer available.";
    default: return "This invitation link isn't valid. It may have been replaced by a newer email.";
  }
}

export interface CompRow {
  id: string; email: string; user_id: string | null; plan: CompPlan; state: CompState; status: string;
  duration_days: number; included_seats: number; extra_seats: number; company_id: string | null;
  starts_at: string | null; expires_at: string | null; paused_at: string | null; activated_at: string | null;
  invite_expires_at: string | null; invite_sent_at: string | null; invite_send_count: number;
  note: string | null; created_at: string; revoked_at: string | null; revoke_reason: string | null;
  granted_by_email: string | null; account_name: string | null; last_activity_at: string | null;
  paid_now: boolean; converted: boolean;
}

export interface CompMetrics {
  active: number; pending: number; expiring_soon: number; expired: number; invite_expired: number;
  revoked: number; paused: number; unlimited: number; enterprise: number; converted: number; total: number;
}

export interface CompHistoryEntry { at: string; action: string; details: Record<string, unknown> | null; actor_email: string | null }

export function daysLeft(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000));
}
