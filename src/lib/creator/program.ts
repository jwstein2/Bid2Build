/**
 * Creator Partner Program (invitation-only Learning Enterprise). Pure definitions shared by the owner
 * admin, the creator dashboard, the participant pages and tests. Entitlement and every permission
 * check live in Postgres (20261117001000_creator_partner_program.sql).
 *
 * This is NOT a public plan: nothing here is referenced by pricing, checkout or plan selection.
 */
import { z } from "zod";

export const PROGRAM_NAME = "Built2Bid Learning Enterprise";
/** Recommended gift allowances (owner may override 0..50). */
export const GIFT_TIERS = [5, 10] as const;
export const MAX_GIFT_ALLOWANCE = 50;
export const TERMS_VERSION = "creator-pilot-v1";

export type ProgramState = "draft" | "awaiting_activation" | "active" | "ended" | "revoked";
export type GiftState = "invited" | "invite_expired" | "active" | "expired" | "revoked";

export const PROGRAM_STATE_LABELS: Record<ProgramState, string> = {
  draft: "Draft (not provisioned)",
  awaiting_activation: "Waiting for creator to accept",
  active: "Active",
  ended: "Ended",
  revoked: "Cancelled",
};
export const GIFT_STATE_LABELS: Record<GiftState, string> = {
  invited: "Invitation sent",
  invite_expired: "Invitation expired",
  active: "Active",
  expired: "Membership ended",
  revoked: "Removed",
};
export const GIFT_STATE_TONES: Record<GiftState, "neutral" | "ok" | "warn" | "danger" | "brand" | "accent"> = {
  invited: "accent", invite_expired: "warn", active: "ok", expired: "neutral", revoked: "danger",
};

const email = z.string().trim().toLowerCase().max(320).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address.");

export const ProgramInput = z.object({
  email,
  workspaceName: z.string().trim().min(2, "Name the workspace.").max(120),
  channelName: z.string().trim().max(200).optional(),
  channelUrl: z.string().trim().max(500).regex(/^https:\/\//, "Use an https:// link.").optional().or(z.literal("")),
  giftAllowance: z.coerce.number().int().min(0).max(MAX_GIFT_ALLOWANCE),
  prospectId: z.string().uuid().optional().or(z.literal("")),
});
export const TermsInput = z.object({
  id: z.string().uuid(),
  termsVersion: z.string().trim().min(1).max(40),
  evidence: z.string().trim().min(10, "Describe the creator's explicit acceptance (at least 10 characters).").max(1000),
  /** The owner must confirm this is explicit acceptance of the terms, not casual interest. */
  confirmExplicit: z.literal(true, { message: "Confirm the creator explicitly accepted the program terms." }),
});
export const GiftInviteInput = z.object({
  programId: z.string().uuid(),
  email,
  displayName: z.string().trim().max(120).optional(),
  replaces: z.string().uuid().optional(),
});
export const ShareInput = z.object({
  programId: z.string().uuid(),
  estimateId: z.string().uuid(),
  shareCosts: z.boolean().default(false),
  shareMargin: z.boolean().default(false),
  shareProjectInfo: z.boolean().default(false),
});
export const ConsentInput = z.object({
  programId: z.string().uuid(),
  allowComments: z.boolean(),
  allowSuggestions: z.boolean(),
  sharePipelineSummary: z.boolean(),
});
export const CommentInput = z.object({
  shareId: z.string().uuid(),
  kind: z.enum(["comment", "suggestion"]),
  body: z.string().trim().min(1, "Write something first.").max(4000),
});
export const ResourceInput = z.object({
  programId: z.string().uuid(),
  id: z.string().uuid().optional(),
  kind: z.enum(["link", "note", "checklist"]),
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().max(1000).regex(/^https:\/\//, "Links must start with https://").optional().or(z.literal("")),
  body: z.string().trim().max(4000).optional(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
}).superRefine((v, ctx) => {
  if (v.kind === "link" && !v.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Add the link." });
});

/**
 * What each sharing permission means, in the participant's words. Shown on the sharing-control screen;
 * every permission is independent and revocable.
 */
export const SHARE_PERMISSIONS = [
  { key: "proposal", label: "Customer-facing proposal", always: true,
    help: "The scope sections and line items your customer would see, and the proposal total. Never your customer's name, email, phone or address." },
  { key: "shareCosts", label: "Internal cost details",
    help: "Quantities, unit costs and cost types, including items hidden from the proposal." },
  { key: "shareMargin", label: "Markup and margin",
    help: "Your markup or margin settings, adjustments and tax rate." },
  { key: "shareProjectInfo", label: "Project information",
    help: "The bid title, date, city/state and pipeline stage. Your bid title may contain a customer name, so check it first." },
] as const;

export const CONSENT_PERMISSIONS = [
  { key: "allowComments", label: "Allow coaching comments", help: "Your mentor can leave notes on the bids you share." },
  { key: "allowSuggestions", label: "Allow edit suggestions", help: "Your mentor can suggest changes as notes. Nothing is ever changed in your bid; you decide what to apply." },
  { key: "sharePipelineSummary", label: "Share my pipeline summary", help: "Counts only: how many bids are in each stage, and how many you won or lost in the last 90 days. No customers, addresses or amounts." },
] as const;

const ERRORS: Record<string, string> = {
  forbidden: "You don't have access to that.",
  program_inactive: "This Learning Enterprise program isn't active.",
  confirm_terms_first: "Review and confirm the program terms first.",
  invalid_email: "Enter a valid email address.",
  invalid_token: "Could not create a secure invitation. Try again.",
  cannot_gift_self: "You can't gift a membership to yourself.",
  no_seats: "All of your gift memberships are in use. Remove a participant or cancel an invitation to free one.",
  already_gifted: "This person already had a gift membership in this program, so it can't be given again.",
  already_invited: "This email already has an open invitation.",
  invite_limit: "This program has reached its invitation limit. Contact Built2Bid if you need more.",
  rate_limited: "Too many changes in a short time. Try again later.",
  not_pending: "That invitation was already accepted or cancelled.",
  comments_off: "This participant hasn't turned on coaching comments.",
  suggestions_off: "This participant hasn't turned on edit suggestions.",
  invalid_body: "Write between 1 and 4,000 characters.",
  invalid_kind: "That kind of note isn't allowed here.",
  not_shared: "This participant hasn't shared their pipeline summary.",
  too_many: "That's the maximum for now.",
  invalid_resource: "Check the resource fields.",
  // owner
  program_exists: "This creator already has an open program.",
  invalid_program: "Check the program fields.",
  invalid_allowance: `Gift allowance must be 0 to ${MAX_GIFT_ALLOWANCE}.`,
  evidence_required: "Describe the creator's explicit acceptance.",
  terms_version_required: "Enter the terms version.",
  not_draft: "This program was already provisioned.",
  terms_not_accepted: "Record the creator's explicit acceptance of the terms before provisioning.",
  below_used: "The allowance can't be lower than the seats already in use.",
  not_found: "That program no longer exists.",
  grant_exists: "This email already has an open complimentary grant. End or revoke it first, or use a different email.",
};

export function creatorErrorMessage(raw: string | null | undefined): string {
  return ERRORS[(raw ?? "").trim()] ?? "Something went wrong. Nothing was changed.";
}

export function giftClaimMessage(reason: string | undefined, hint?: string): string {
  switch (reason) {
    case "email_mismatch": return `This gift was sent to ${hint ?? "a different email"}. Sign in with that email address to accept it.`;
    case "email_unverified": return "Verify the email address this gift was sent to (Settings → Account), then open the link again.";
    case "invite_expired": return "This gift invitation has expired. Ask the creator who invited you to send a new link.";
    case "revoked": return "This gift invitation was cancelled.";
    case "program_inactive": return "This creator program has ended, so the gift can no longer be accepted.";
    case "already_gifted": return "Your account already has a creator gift membership.";
    case "already_complimentary": return "Your account already has complimentary Built2Bid access, so this gift can't be added. Ask the creator to give it to someone else.";
    case "cannot_gift_self": return "This gift can't be claimed by the creator's own account.";
    default: return "This gift link isn't valid. It may have been replaced by a newer one.";
  }
}

export interface CreatorProgramRow {
  id: string; creator_email: string; creator_user_id: string | null; workspace_name: string; channel_name: string | null;
  channel_url: string | null; prospect_id: string | null; gift_allowance: number; program_days: number; status: string;
  state: ProgramState; terms_version: string | null; terms_accepted_at: string | null; terms_evidence: string | null;
  creator_confirmed_at: string | null; comp_grant_id: string | null; starts_at: string | null; expires_at: string | null;
  ended_at: string | null; end_reason: string | null; created_at: string; seats_used: number; gifts_active: number;
  gifts_pending: number; shares_open: number; creator_grant_state: string | null; gift_conversions: number;
}

export interface CreatorGiftRow {
  id: string; email: string; display_name?: string | null; state: GiftState; invited_at: string; invite_expires_at?: string;
  claimed_at: string | null; business_name?: string | null; primary_trade?: string | null; last_engagement?: string | null;
  shared_count?: number; consent?: { allow_comments: boolean; allow_suggestions: boolean; share_pipeline_summary: boolean } | null;
}

/** Days left (ceil), never negative. */
export function daysRemaining(expiresAt: string | null | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000));
}

/** "Johnson Deck Academy — Built2Bid Learning Team" from a channel/academy name. */
export function defaultWorkspaceName(channelOrAcademy: string): string {
  const base = channelOrAcademy.replace(/\s+/g, " ").trim().slice(0, 80) || "Creator";
  return `${base} — Built2Bid Learning Team`;
}
