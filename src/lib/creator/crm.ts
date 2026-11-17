/** Creator Partnerships CRM: stage labels, groups and metric definitions (pure). */
export const STAGES = [
  "researched", "qualified", "draft_ready", "approved", "initial_sent", "follow_up_scheduled", "follow_up_sent", "awaiting_response",
  "interested", "questions", "accepted", "no_response_first_cohort", "opportunity_reallocated", "declined", "unsubscribed", "bounced", "needs_review",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  researched: "Researched",
  qualified: "Qualified",
  draft_ready: "Outreach draft ready",
  approved: "Approved, queued to send",
  initial_sent: "Initial Email Sent",
  follow_up_scheduled: "Follow-Up Scheduled",
  follow_up_sent: "Follow-Up Sent",
  awaiting_response: "Awaiting Response",
  interested: "Interested",
  questions: "Has questions",
  accepted: "Accepted",
  no_response_first_cohort: "No Response — First Cohort",
  opportunity_reallocated: "Opportunity Reallocated",
  declined: "Declined",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  needs_review: "Needs manual review",
};

export const STAGE_TONES: Record<Stage, "neutral" | "ok" | "warn" | "danger" | "brand" | "accent"> = {
  researched: "neutral", qualified: "brand", draft_ready: "accent", approved: "accent", initial_sent: "brand", follow_up_scheduled: "brand",
  follow_up_sent: "brand", awaiting_response: "brand", interested: "ok", questions: "ok", accepted: "ok", no_response_first_cohort: "warn",
  opportunity_reallocated: "neutral", declined: "neutral", unsubscribed: "danger", bounced: "danger", needs_review: "warn",
};

/** Owner-dashboard modules (Part 8) as filter groups. */
export const STAGE_GROUPS: { key: string; label: string; stages: Stage[] }[] = [
  { key: "discover", label: "Discover", stages: ["researched"] },
  { key: "qualified", label: "Qualified creators", stages: ["qualified"] },
  { key: "drafts", label: "Outreach drafts", stages: ["draft_ready", "approved"] },
  { key: "conversations", label: "Conversations", stages: ["initial_sent", "follow_up_scheduled", "follow_up_sent", "awaiting_response", "interested", "questions", "needs_review"] },
  { key: "accepted", label: "Accepted partners", stages: ["accepted"] },
  { key: "closed", label: "Closed", stages: ["no_response_first_cohort", "opportunity_reallocated", "declined", "unsubscribed", "bounced"] },
];

/** Stages the owner may set by hand. Sent/scheduled states are only set by the scheduler. */
export const MANUAL_STAGES: Stage[] = ["researched", "qualified", "interested", "questions", "accepted", "declined", "needs_review"];

export const isStage = (s: unknown): s is Stage => typeof s === "string" && (STAGES as readonly string[]).includes(s);

export interface ProspectLite {
  stage: string; initial_sent_at: string | null; follow_up_sent_at: string | null; replied_at: string | null;
  replied_after: string | null; reply_classification: string | null;
}

/** Addendum §6 dashboard metrics. */
export function outreachMetrics(rows: ProspectLite[]) {
  const sent = rows.filter((r) => r.initial_sent_at);
  const replied = sent.filter((r) => r.replied_at && r.reply_classification !== "bounce");
  const positive = replied.filter((r) => ["interested", "questions"].includes(r.reply_classification ?? "") || r.stage === "accepted");
  return {
    initialSent: sent.length,
    followUpsSent: rows.filter((r) => r.follow_up_sent_at).length,
    repliesAfterInitial: replied.filter((r) => r.replied_after === "initial").length,
    repliesAfterFollowUp: replied.filter((r) => r.replied_after === "follow_up").length,
    positiveRate: sent.length ? Math.round((positive.length / sent.length) * 1000) / 10 : 0,
    accepted: rows.filter((r) => r.stage === "accepted").length,
    unresponsive: rows.filter((r) => r.stage === "no_response_first_cohort" || r.stage === "opportunity_reallocated").length,
    reallocated: rows.filter((r) => r.stage === "opportunity_reallocated").length,
  };
}

export const EXPORT_COLUMNS = [
  "rank", "score", "trade", "channel_name", "creator_name", "channel_url", "channel_id", "subscribers_text", "lifetime_views", "website",
  "contact_email", "contact_source_url", "contact_status", "contact_verified_at", "gift_tier", "personalization", "stage", "cohort",
  "initial_sent_at", "follow_up_due_at", "follow_up_sent_at", "response_deadline_at", "replied_at", "reply_classification",
  "first_wave", "waitlist", "confidence", "verification_date", "gaps", "sources",
] as const;
