/**
 * Customer communications (V4.6): shared types. Two separate kinds of email:
 *   nurture         commercial re-engagement with past customers / prospects (opt-out, offers allowed)
 *   project_update  informational progress reports for active projects (never promotional)
 */
export type AudienceGroup = "lost" | "unconverted" | "old_draft" | "completed" | "past_customer";
export const AUDIENCE_GROUPS: { value: AudienceGroup; label: string; detail: string }[] = [
  { value: "lost", label: "Lost bids", detail: "Bids you marked Lost." },
  { value: "unconverted", label: "Sent, not signed", detail: "Proposals sent more than 30 days ago that never moved forward." },
  { value: "old_draft", label: "Older drafts", detail: "Drafts older than 90 days. Only included after you confirm you have a real relationship with the person." },
  { value: "completed", label: "Completed projects", detail: "Customers whose project was completed in the last two years." },
  { value: "past_customer", label: "Past customers", detail: "Customers with a completed project more than two years ago and nothing in progress." },
];

export type ContactStatus = "eligible" | "paused" | "replied" | "unsubscribed" | "bounced" | "suppressed";
export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  eligible: "Eligible", paused: "Paused", replied: "Replied", unsubscribed: "Unsubscribed", bounced: "Bounced", suppressed: "Suppressed",
};
export type Basis = "inquiry" | "customer" | "confirmed";

export type MessageStatus = "draft" | "scheduled" | "awaiting_review" | "approved" | "sending" | "sent" | "delivered" | "failed" | "paused" | "replied" | "canceled" | "skipped";
export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  draft: "Draft", scheduled: "Scheduled", awaiting_review: "Awaiting review", approved: "Approved", sending: "Sending", sent: "Sent",
  delivered: "Delivered", failed: "Failed", paused: "Paused", replied: "Replied", canceled: "Canceled", skipped: "Skipped",
};
/** Messages that may still go out. Suppression and pausing cancel these. */
export const QUEUED_STATUSES: MessageStatus[] = ["draft", "scheduled", "awaiting_review", "approved", "failed", "paused"];

export type CommKind = "nurture" | "project_update";
export type Trigger = "six_month" | "weekly" | "milestone" | "manual";
export type UpdateFrequency = "off" | "weekly" | "milestone" | "both";
export type SendMode = "review" | "automatic";
export const FREQUENCY_LABEL: Record<UpdateFrequency, string> = { off: "Off", weekly: "Weekly", milestone: "Verified section completion", both: "Weekly + section completion" };

export type OfferType = "percent" | "fixed" | "seasonal" | "material" | "financing" | "custom";
export const OFFER_TYPE_LABEL: Record<OfferType, string> = {
  percent: "Percentage discount", fixed: "Fixed-dollar discount", seasonal: "Seasonal promotion", material: "Material alternative", financing: "Financing mention", custom: "Custom message",
};
export interface Offer {
  id: string; name: string; offerType: OfferType; trades: string[]; audience: AudienceGroup[]; startsOn: string; endsOn: string;
  conditions: string; discountValue: number | null; message: string; materialCurrent: string | null; materialAlternative: string | null;
  priceBasis: "verified" | "contractor_estimate" | null; estimatedSavings: string | null; comparisonApprovedAt: string | null; active: boolean;
}

export type CommPermission = "view_communications" | "edit_nurture_templates" | "enable_customer_nurture" | "approve_marketing_outreach"
  | "configure_project_updates" | "approve_customer_updates" | "enable_auto_project_updates" | "view_customer_replies" | "manage_opt_outs";
export interface CommAccess { accountId: string | null; kind: "company" | "user" | "none"; pm: boolean; perms: CommPermission[] }

export interface CommSettings {
  nurtureEnabled: boolean; nurtureMonths: number; nurtureIncludeOffers: boolean; nurtureMode: SendMode;
  nurtureSubject: string | null; nurtureBody: string | null; templateVersion: number; nurtureActivatedAt: string | null;
  updatesFrequency: UpdateFrequency; updatesMode: SendMode; updatesWeekday: number; updatesHour: number; timezone: string;
  postalAddress: string | null; senderName: string | null; replyTo: string | null; pausedAt: string | null;
  /** The account owner turned customer emails off for the whole account (stays off until the owner turns it on). */
  disabledAt: string | null; disabledReason: string | null;
  termsAcceptedAt: string | null; termsVersion: number | null;
}
export const DEFAULT_SETTINGS: CommSettings = {
  nurtureEnabled: false, nurtureMonths: 6, nurtureIncludeOffers: false, nurtureMode: "review", nurtureSubject: null, nurtureBody: null, templateVersion: 1,
  nurtureActivatedAt: null, updatesFrequency: "off", updatesMode: "review", updatesWeekday: 5, updatesHour: 16, timezone: "America/Chicago",
  postalAddress: null, senderName: null, replyTo: null, pausedAt: null,
  disabledAt: null, disabledReason: null, termsAcceptedAt: null, termsVersion: null,
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
export function mapSettings(r: Row | null | undefined): CommSettings {
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    nurtureEnabled: r.nurture_enabled === true, nurtureMonths: Number(r.nurture_months ?? 6), nurtureIncludeOffers: r.nurture_include_offers === true,
    nurtureMode: r.nurture_mode === "automatic" ? "automatic" : "review", nurtureSubject: str(r.nurture_subject), nurtureBody: str(r.nurture_body),
    templateVersion: Number(r.template_version ?? 1), nurtureActivatedAt: str(r.nurture_activated_at),
    updatesFrequency: (r.updates_frequency as UpdateFrequency) ?? "off", updatesMode: r.updates_mode === "automatic" ? "automatic" : "review",
    updatesWeekday: Number(r.updates_weekday ?? 5), updatesHour: Number(r.updates_hour ?? 16), timezone: str(r.timezone) ?? "America/Chicago",
    postalAddress: str(r.postal_address), senderName: str(r.sender_name), replyTo: str(r.reply_to), pausedAt: str(r.paused_at),
    disabledAt: str(r.disabled_at), disabledReason: str(r.disabled_reason),
    termsAcceptedAt: str(r.terms_accepted_at), termsVersion: r.terms_version === null || r.terms_version === undefined ? null : Number(r.terms_version),
  };
}
export function mapOffer(r: Row): Offer {
  return {
    id: String(r.id), name: String(r.name), offerType: r.offer_type as OfferType, trades: (r.trades as string[]) ?? [], audience: (r.audience as AudienceGroup[]) ?? [],
    startsOn: String(r.starts_on), endsOn: String(r.ends_on), conditions: String(r.conditions ?? ""), discountValue: r.discount_value === null || r.discount_value === undefined ? null : Number(r.discount_value),
    message: String(r.message ?? ""), materialCurrent: str(r.material_current), materialAlternative: str(r.material_alternative),
    priceBasis: (r.price_basis as Offer["priceBasis"]) ?? null, estimatedSavings: str(r.estimated_savings), comparisonApprovedAt: str(r.comparison_approved_at), active: r.active === true,
  };
}

export const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
export function normalizeEmail(v: unknown): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  return e.length <= 320 && EMAIL_RE.test(e) ? e : null;
}
