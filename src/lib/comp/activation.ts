import type { CompRow } from "./grants";
import { daysLeft } from "./grants";

/**
 * Activation summary for complimentary access (owner admin): did the person accept, sign in and start a bid,
 * and who needs a nudge before their access runs out. Pure: the page supplies the first-estimate facts.
 */
export type Activation = "invite_pending" | "not_started" | "active" | "inactive" | "ended";
export const ACTIVATION_LABELS: Record<Activation, string> = {
  invite_pending: "Hasn't accepted", not_started: "Not started", active: "Active", inactive: "Inactive", ended: "Access ended",
};
export const ACTIVATION_TONES: Record<Activation, "neutral" | "ok" | "warn" | "danger"> = {
  invite_pending: "warn", not_started: "warn", active: "ok", inactive: "danger", ended: "neutral",
};

/** Days without activity after which an account counts as inactive. */
export const INACTIVE_AFTER_DAYS = 14;

export interface FirstEstimate { at: string; count: number }
export interface ActivationRow {
  activation: Activation;
  inviteStatus: "pending" | "accepted" | "expired";
  firstEstimate: FirstEstimate | null;
  daysLeft: number | null;
  followUp: boolean;
  /** Why it needs a follow-up, in plain words (null when it doesn't). */
  reason: string | null;
}

const DAY = 86_400_000;
const ago = (iso: string | null, now: number) => (iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : null);

export function activationFor(r: CompRow, first: FirstEstimate | null, now = Date.now()): ActivationRow {
  const inviteStatus = r.state === "pending" ? "pending" : r.state === "invite_expired" ? "expired" : "accepted";
  const left = r.state === "active" || r.state === "paused" ? daysLeft(r.expires_at, now) : null;
  const paying = r.paid_now || r.converted;
  const base = { inviteStatus, firstEstimate: first, daysLeft: left } as const;

  if (r.state === "revoked" || r.state === "expired") return { ...base, activation: "ended", followUp: false, reason: null };
  if (inviteStatus !== "accepted") {
    const sent = ago(r.invite_sent_at ?? r.created_at, now) ?? 0;
    const follow = inviteStatus === "expired" || sent >= 3;
    return { ...base, activation: "invite_pending", followUp: follow,
      reason: follow ? (inviteStatus === "expired" ? "Invitation expired without being accepted" : `Invitation sent ${sent} days ago, not accepted`) : null };
  }
  const idle = ago(r.last_activity_at, now);
  const activation: Activation = !first ? "not_started" : idle !== null && idle <= INACTIVE_AFTER_DAYS ? "active" : "inactive";
  let reason: string | null = null;
  if (!paying) {
    const since = ago(r.activated_at ?? r.starts_at, now) ?? 0;
    if (activation === "not_started" && since >= 2) reason = `Accepted ${since} days ago, no bid started`;
    else if (activation === "inactive") reason = idle === null ? "No activity recorded" : `No activity for ${idle} days`;
    else if (left !== null && left <= 7) reason = `Access ends in ${left} day${left === 1 ? "" : "s"}, not paying yet`;
  }
  return { ...base, activation, followUp: reason !== null, reason };
}

/** Plain-text email the owner can send from their own mail app (nothing is sent by Built2Bid). */
export function followUpMailto(r: CompRow, a: ActivationRow, siteUrl: string): string {
  const subject = a.activation === "invite_pending" ? "Your free Built2Bid access is waiting" : a.activation === "not_started" ? "Need a hand starting your first bid?" : "Checking in on Built2Bid";
  const lines = [
    "Hi,",
    "",
    a.activation === "invite_pending"
      ? "I set you up with free access to Built2Bid, but it looks like the invitation hasn't been accepted yet. Check your inbox (and spam folder) for the invitation, or reply and I'll send a fresh one."
      : a.activation === "not_started"
        ? `Your free Built2Bid access is ready. The quickest way to see what it does is to start one real bid: ${siteUrl}/bids`
        : "Just checking in to see how Built2Bid is working for you. Is there anything I can help you set up?",
    ...(a.daysLeft !== null ? ["", `Your complimentary access runs for ${a.daysLeft} more day${a.daysLeft === 1 ? "" : "s"}.`] : []),
    "",
    "Thanks,",
  ];
  return `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}
