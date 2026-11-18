/**
 * Customer communications rollout (V6.10): the customer email terms a contractor accepts before the
 * first email can be approved or sent, the recommended settings, and the account owner's off switch.
 * Shared by the API, the cron runner and the Communications page, so the wording lives in one place.
 */
import type { CommSettings, UpdateFrequency } from "./types";

/** Bump when the terms change materially: everyone accepts the new version before the next send. */
export const COMM_TERMS_VERSION = 1;

/** What the contractor agrees to. Plain language; shown in full before acceptance. */
export const COMM_TERMS: { title: string; body: string }[] = [
  { title: "You're the sender", body: "Emails go out under your business name, from Built2Bid's sending service, on your behalf. You're responsible for what you approve and for following the email laws that apply to you (CAN-SPAM in the US, CASL in Canada)." },
  { title: "Only people you know", body: "Only email customers and people who asked you for a quote. Never add purchased, rented or scraped lists. Built2Bid only suggests people from your own bids and projects." },
  { title: "Follow-ups are marketing", body: "Every follow-up includes your business name, your postal address and a one-click unsubscribe. Unsubscribes, bounces and complaints are honored for your whole account and can't be undone by your team." },
  { title: "Project updates are informational", body: "Progress emails only describe this customer's project from your schedule. They never include offers, and work is only called complete after someone on your team confirms it." },
  { title: "Review first by default", body: "Nothing sends until someone on your team approves it. Automatic sending stays off until replies can be detected, and is then turned on deliberately, one project at a time." },
  { title: "Replies come to you", body: "Customers reply to the address in your sender details. Answer replies personally, and use \"Mark replied\" so that person isn't followed up automatically." },
  { title: "Limits and records", body: "Built2Bid caps daily sending per account, keeps a record of every email, approval and opt-out, and may pause sending if bounces or complaints look unusual." },
];

/** The recommended starting point, applied with one click (never turns anything on by itself). */
export const RECOMMENDED = {
  nurtureMonths: 6,
  nurtureIncludeOffers: false,
  nurtureMode: "review" as const,
  updatesFrequency: "milestone" as UpdateFrequency,
  updatesWeekday: 5, // Friday
  updatesHour: 16, // 4 PM local
};

export const RECOMMENDED_NOTES = [
  "Follow-ups at most every 6 months, review first, no offers",
  "Project updates when a section is confirmed complete (no weekly emails unless you choose them)",
  "Weekly updates, if you use them, on Friday at 4 PM your time",
  "Sender name, postal address and reply address from your company profile",
];

export const termsCurrent = (s: Pick<CommSettings, "termsAcceptedAt" | "termsVersion">) => Boolean(s.termsAcceptedAt) && (s.termsVersion ?? 0) >= COMM_TERMS_VERSION;

export const DISABLED_MESSAGE = "Customer emails are turned off for your company by the account owner.";
export const TERMS_MESSAGE = "Accept the customer email terms in Customers → Communications before emails can be approved or sent.";
