/**
 * Getting started checklist (2026-11-22): one card on Home that walks a new contractor from an empty
 * account to a signed job, and stays until every step is done or they hide it. Pure: the server loader
 * (checklist-server.ts) gathers the facts, this decides the steps, so it's unit-tested without a database.
 */

export interface ChecklistFacts {
  /** Company name entered on the profile. */
  companyName: boolean;
  /** Logo uploaded. */
  logo: boolean;
  /** Getting started tour finished (profiles.onboarding_status = completed). */
  tourDone: boolean;
  /** Bids this person owns (any stage). */
  bids: number;
  /** Bids at "sent" or later. */
  sentBids: number;
  /** Bids won (won, scheduled, in progress or completed). */
  wonBids: number;
  /** Customer signing links created (any status). A link going out counts as sending the proposal,
   *  even on accounts where the bid's pipeline stage was never moved. Optional for older callers. */
  signingLinks?: number;
  /** Customer signatures. A signed bid is both sent and won, whatever its pipeline stage says. */
  signedBids?: number;
  /** Saved Items & Pricing rows. */
  savedItems: number;
  /** Most recently updated bid, so "Send a proposal" continues where they left off. */
  latestBidId?: string | null;
}

export type StepId = "company" | "tour" | "first-bid" | "saved-items" | "send" | "win";

export interface ChecklistStep {
  id: StepId;
  title: string;
  why: string;
  done: boolean;
  /** Where the one action button goes. */
  href: string;
  action: string;
  /** Opens the getting started tour instead of navigating. */
  opensTour?: boolean;
}

export const SENT_OR_LATER = ["sent", "pending", "won", "scheduled", "in_progress", "completed"] as const;
export const WON_OR_LATER = ["won", "scheduled", "in_progress", "completed"] as const;

export function checklistSteps(f: ChecklistFacts): ChecklistStep[] {
  return [
    {
      id: "company", done: f.companyName && f.logo,
      title: "Set up your company",
      why: "Your name, logo and contact details go on every proposal. Paste your website and we fill most of it in.",
      href: "/welcome", action: f.companyName ? "Add your logo" : "Set up my company",
    },
    {
      id: "tour", done: f.tourDone,
      title: "Take the 2-minute tour",
      why: "See how a bid goes from trade to signed proposal.",
      href: "/home", action: "Start the tour", opensTour: true,
    },
    {
      id: "first-bid", done: f.bids > 0,
      title: "Build your first bid",
      why: "Pick your trade and Built2Bid opens an estimate with sections and items ready to price.",
      href: "/bids", action: "Create a bid",
    },
    {
      id: "saved-items", done: f.savedItems > 0,
      title: "Save your prices",
      why: "Save your labor rates and material costs once, then add them to any bid in a tap.",
      href: "/dashboard/items", action: "Open Saved Items",
    },
    {
      id: "send", done: f.sentBids > 0 || (f.signingLinks ?? 0) > 0 || (f.signedBids ?? 0) > 0,
      title: "Send a proposal",
      why: "Preview it, then email it from your own address with a secure signing link.",
      href: f.latestBidId ? `/estimates/${f.latestBidId}?step=proposal` : "/bids", action: f.latestBidId ? "Finish my latest bid" : "Create a bid first",
    },
    {
      id: "win", done: f.wonBids > 0 || (f.signedBids ?? 0) > 0,
      title: "Win your first job",
      why: "When the customer signs, the bid moves to Won and you can schedule and invoice it.",
      href: "/dashboard", action: "See my pipeline",
    },
  ];
}

/** The first step that isn't done is the one the card highlights. */
export const nextStep = (steps: ChecklistStep[]) => steps.find((s) => !s.done) ?? null;

/** user_metadata key that hides the card (set from the card's Hide button). Hiding the older first-bid
 *  checklist on My bids (growth/activation CHECKLIST_DISMISSED_KEY) hides this one too, and vice versa. */
export const CHECKLIST_META_KEY = "b2b_checklist_hidden";
