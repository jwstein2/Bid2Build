/**
 * Conversation state machine for Opportunity Radar, including the two-reply cap.
 * The same rules are enforced in Postgres (radar_drafts triggers), so a bug in the app cannot exceed
 * the cap; this module lets the UI show the right actions and gives clear error messages.
 */

export const STATUSES = ["new", "awaiting_review", "approved", "active", "followup_pending", "completed", "rejected", "archived"] as const;
export type OppStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<OppStatus, string> = {
  new: "New",
  awaiting_review: "Awaiting response review",
  approved: "Approved, not posted",
  active: "Active conversation",
  followup_pending: "Follow-up awaiting approval",
  completed: "Completed",
  rejected: "Rejected / irrelevant",
  archived: "Archived",
};

export const REPLY_CAP = 2;

export interface OppState {
  status: OppStatus;
  owner_replies_used: number;
  /** Owner explicitly reopened a completed conversation for one more (support) reply. */
  reopened: boolean;
}

export type Check = { ok: true } | { ok: false; reason: string };

export function canDraft(o: OppState, replyNumber: number): Check {
  if (o.status === "rejected" || o.status === "archived") return { ok: false, reason: "This discussion is rejected or archived. Restore it first." };
  if (o.status === "completed" && !o.reopened) return { ok: false, reason: "This conversation is complete (two replies used). Reopen it if a customer still needs help." };
  if (replyNumber !== o.owner_replies_used + 1) return { ok: false, reason: `The next reply here is reply ${o.owner_replies_used + 1}.` };
  if (replyNumber > REPLY_CAP && !o.reopened) return { ok: false, reason: "The two-reply limit is reached." };
  return { ok: true };
}

/** A follow-up from the other person can only be logged after reply 1 was posted (and before reply 2). */
export function canLogFollowUp(o: OppState): Check {
  if (o.status === "completed" && !o.reopened) return { ok: false, reason: "Conversation complete. Reopen it to answer another question." };
  if (o.owner_replies_used < 1) return { ok: false, reason: "Post your first reply before logging a follow-up." };
  if (o.owner_replies_used >= REPLY_CAP && !o.reopened) return { ok: false, reason: "The two-reply limit is reached." };
  return { ok: true };
}

/** State after the owner confirms a reply was actually posted (or the platform confirmed it). */
export function afterPosted(o: OppState): OppState {
  const used = o.owner_replies_used + 1;
  if (o.reopened || used >= REPLY_CAP) return { status: "completed", owner_replies_used: used, reopened: false };
  return { status: "active", owner_replies_used: used, reopened: false };
}

export function canReopen(o: OppState): Check {
  if (o.status !== "completed") return { ok: false, reason: "Only completed conversations can be reopened." };
  if (o.reopened) return { ok: false, reason: "Already reopened." };
  return { ok: true };
}

/** Routine automation (drafting suggestions, digests) never targets these. */
export const isClosedForOutreach = (o: OppState) => o.status === "completed" && !o.reopened || o.status === "rejected" || o.status === "archived";

export function nextAction(o: OppState & { score?: number; hasDraft?: boolean }): string {
  switch (o.status) {
    case "new": return (o.score ?? 0) >= 40 ? "Generate a first reply" : "Archive unless useful";
    case "awaiting_review": return o.owner_replies_used === 0 ? "Review draft reply 1" : "Review follow-up reply";
    case "approved": return "Post it, then mark posted";
    case "active": return "Watch for a direct reply";
    case "followup_pending": return "Approve reply 2";
    case "completed": return o.reopened ? "Write support reply" : "None (closed)";
    case "rejected": return "None";
    case "archived": return "None";
  }
}
