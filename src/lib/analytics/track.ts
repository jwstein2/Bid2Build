/**
 * Browser conversion signals for GA4 and (only with consent) the Meta Pixel. Tiny, dependency-free,
 * and a no-op when neither tag is loaded. Never pass names, emails, addresses, prices or bid amounts.
 * Business milestones are recorded on the server; these calls only mirror them for ad platforms,
 * using the same event_id so Meta can deduplicate browser + server copies.
 */
type Params = Record<string, string | number | undefined>;
type W = Window & { gtag?: (...a: unknown[]) => void; fbq?: (...a: unknown[]) => void };

const META_STANDARD: Record<string, string> = { sign_up: "CompleteRegistration", landing_view: "ViewContent", signup_started: "Lead" };
const META_CUSTOM: Record<string, string> = { bid_activated: "ActivatedContractor", pdf_exported: "ProposalExported", bid_check_complete: "BidCheckComplete", bid_check_invite: "PassRequested" };

export type TrackEvent = "landing_view" | "signup_started" | "sign_up" | "proposal_previewed" | "pdf_exported" | "begin_checkout" | "bid_activated"
  // Bid check questionnaire (answer keys only: trade, goal, campaign; never an email or name).
  | "bid_check_start" | "bid_check_complete" | "bid_check_result" | "bid_check_invite";

export function track(event: TrackEvent, params: Params = {}, eventId?: string) {
  if (typeof window === "undefined") return;
  const w = window as W;
  const clean: Params = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && (typeof v === "number" || /^[\w\-/ .]{0,100}$/.test(v))) clean[k] = v;
  try { w.gtag?.("event", event, clean); } catch { /* analytics never breaks the page */ }
  try {
    if (!w.fbq) return;
    const opts = eventId ? { eventID: eventId } : undefined;
    if (META_STANDARD[event]) w.fbq("track", META_STANDARD[event], { content_category: clean.trade }, opts);
    else if (META_CUSTOM[event]) w.fbq("trackCustom", META_CUSTOM[event], { content_category: clean.trade }, opts);
  } catch { /* ignore */ }
}

/** Account created in the last 15 minutes (a sign-in that just registered). */
export const isNewAccount = (createdAt: string, now = Date.now()) => now - Date.parse(createdAt) < 15 * 60_000;
