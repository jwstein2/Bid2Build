import type { AccountFact } from "./model";

/**
 * Setup funnel (2026-11-22): of the accounts that signed up in a window, how many reached each step
 * from sign-up to paying. Built from the same account facts (and genuine-account scope) as every owner
 * report, so the numbers agree with Product usage. Each step counts accounts that reached it at any
 * time so far, not only inside the window.
 */
export interface FunnelStep { key: string; label: string; count: number; /** Share of the step before. */ fromPrev: number | null; /** Share of sign-ups. */ fromStart: number | null }

const STEPS: { key: string; label: string; reached: (f: AccountFact) => boolean }[] = [
  { key: "signup", label: "Signed up", reached: () => true },
  { key: "confirmed", label: "Confirmed their email", reached: (f) => f.confirmed },
  { key: "company", label: "Added a company name", reached: (f) => Boolean(f.business) },
  { key: "bid", label: "Started a bid", reached: (f) => f.estimates > 0 },
  { key: "priced", label: "Priced 3+ line items", reached: (f) => Boolean(f.firstMeaningfulAt) || f.finalized > 0 || f.signingRequests > 0 },
  { key: "sent", label: "Downloaded or sent a proposal", reached: (f) => f.finalized > 0 || f.signingRequests > 0 },
  { key: "signed", label: "Customer signed", reached: (f) => f.signed > 0 },
  { key: "paid", label: "Became a paying customer", reached: (f) => f.everPaid },
];

const share = (n: number, d: number) => (d > 0 ? n / d : null);

export function setupFunnel(facts: AccountFact[], sinceMs: number, untilMs = Date.now()): FunnelStep[] {
  const cohort = facts.filter((f) => { const t = Date.parse(f.createdAt); return t >= sinceMs && t < untilMs; });
  const counts = STEPS.map((s) => cohort.filter(s.reached).length);
  return STEPS.map((s, i) => ({ key: s.key, label: s.label, count: counts[i], fromPrev: i === 0 ? null : share(counts[i], counts[i - 1]), fromStart: share(counts[i], counts[0]) }));
}

/** The step with the biggest drop from the one before (where new contractors get stuck most). */
export function biggestDrop(steps: FunnelStep[]): FunnelStep | null {
  let worst: FunnelStep | null = null;
  for (const s of steps.slice(1)) if (s.fromPrev !== null && (worst === null || s.fromPrev < (worst.fromPrev ?? 1))) worst = s;
  return worst;
}
