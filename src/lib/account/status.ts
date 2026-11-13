/**
 * Account-aware messaging: one place that turns the server's view of a visitor (Supabase session +
 * the credit_status RPC, which already folds in the Stripe subscription via has_unlimited) into the
 * call-to-action labels and promo copy the site shows. Pure, so it is shared by server components,
 * client components and tests. It never decides entitlement: Postgres does (finalize_bid).
 */
import { creditsAvailable, type CreditStatus } from "../credits/status";

export type AccountKind =
  /** Not signed in: public introductory offers apply. */
  | "signed_out"
  /** Signed in on the Free plan with credits left (or balance not known yet, e.g. unverified email). */
  | "free"
  /** Paid Unlimited plan in good standing (incl. canceled-at-period-end and past_due retry window). */
  | "unlimited"
  /** Signed in, Free plan, no credits left. Drafts and existing bids still work. */
  | "no_credits";

export interface AccountStatus {
  kind: AccountKind;
  signedIn: boolean;
  /** Free credits left, only for kind "free" when known. Never shown for Unlimited. */
  creditsLeft: number | null;
  /** When the next free monthly credit arrives (ISO), for Free-plan users. */
  nextCycleAt: string | null;
}

export const SIGNED_OUT: AccountStatus = { kind: "signed_out", signedIn: false, creditsLeft: null, nextCycleAt: null };

export function accountStatusFrom(user: { emailVerified: boolean } | null, credits: CreditStatus | null): AccountStatus {
  if (!user) return SIGNED_OUT;
  if (credits?.unlimited) return { kind: "unlimited", signedIn: true, creditsLeft: null, nextCycleAt: null };
  // Unknown balance (RPC failed) or not yet granted (email unverified): treat as a Free member without a
  // number. Never fall back to signed-out promos or to "out of credits" without proof.
  if (!credits || !credits.emailVerified || !credits.starterGranted) {
    return { kind: "free", signedIn: true, creditsLeft: null, nextCycleAt: credits?.nextCycleAt ?? null };
  }
  const left = creditsAvailable(credits);
  return { kind: left > 0 ? "free" : "no_credits", signedIn: true, creditsLeft: left, nextCycleAt: credits.nextCycleAt };
}

export type CtaAction = "create" | "how" | "bids" | "plans" | "draft";
export interface Cta { action: CtaAction; label: string; href: string }

export const CTA_LABELS = {
  createFree: "Create a Free Bid",
  how: "See How It Works",
  createNew: "Create New Bid",
  bids: "View My Bids",
  plans: "View Plans",
  draft: "Start a Draft",
} as const;

export interface CtaOptions {
  /** Where "create" goes (trade pages open that trade directly). Default /bids. */
  createHref?: string;
  /** Where "See How It Works" goes. Default /#how-it-works. */
  howHref?: string;
}

/** Primary and secondary call to action for this visitor. */
export function accountCtas(s: AccountStatus, opts: CtaOptions = {}): { primary: Cta; secondary: Cta } {
  const create = opts.createHref ?? "/bids";
  const bids: Cta = { action: "bids", label: CTA_LABELS.bids, href: "/dashboard" };
  switch (s.kind) {
    case "signed_out":
      return { primary: { action: "create", label: CTA_LABELS.createFree, href: create }, secondary: { action: "how", label: CTA_LABELS.how, href: opts.howHref ?? "/#how-it-works" } };
    case "free":
    case "unlimited":
      return { primary: { action: "create", label: CTA_LABELS.createNew, href: create }, secondary: bids };
    case "no_credits":
      return { primary: { action: "plans", label: CTA_LABELS.plans, href: "/pricing" }, secondary: bids };
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Short balance text for Free-plan members ("2 free bids left"). Null when it shouldn't be shown. */
export function creditBadge(s: AccountStatus): string | null {
  if (s.kind === "free" && s.creditsLeft !== null) return `${plural(s.creditsLeft, "free bid")} left`;
  if (s.kind === "no_credits") return "No free bids left";
  return null;
}

/** Neutral tagline that replaces "3 free bids to start" for signed-in customers. */
export const MEMBER_TAGLINE = "Professional estimates. Customer-ready proposals.";
