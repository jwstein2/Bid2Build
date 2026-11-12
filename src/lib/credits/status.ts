/**
 * Free bid credits: two separate balances.
 *  - Starter: 3 per verified account, never expire, never replenish.
 *  - Monthly: 1 per monthly cycle from the second cycle on, never rolls over.
 * Enforcement lives only in Postgres (finalize_bid / credit_status). This module just shapes
 * the server's answer for the UI.
 */
export interface CreditStatus {
  starter: number;
  starterTotal: number;
  monthly: number;
  /** False during the account's first monthly cycle. */
  monthlyEligible: boolean;
  /** When the current monthly credit expires and the next one arrives (ISO). */
  nextCycleAt: string;
  unlimited: boolean;
  emailVerified: boolean;
  starterGranted: boolean;
}

export interface CreditStatusRow {
  starter_balance: number;
  starter_total: number;
  monthly_balance: number;
  monthly_eligible: boolean;
  next_cycle_at: string;
  unlimited: boolean;
  email_verified: boolean;
  starter_granted: boolean;
}

export function creditStatusFrom(data: unknown): CreditStatus | null {
  const r = (Array.isArray(data) ? data[0] : data) as CreditStatusRow | null | undefined;
  if (!r) return null;
  return {
    starter: r.starter_balance,
    starterTotal: r.starter_total,
    monthly: r.monthly_balance,
    monthlyEligible: r.monthly_eligible,
    nextCycleAt: new Date(r.next_cycle_at).toISOString(),
    unlimited: r.unlimited,
    emailVerified: r.email_verified,
    starterGranted: r.starter_granted,
  };
}

export function creditsAvailable(s: CreditStatus): number {
  return s.unlimited ? Infinity : s.starter + s.monthly;
}

export type CreditSource = "monthly" | "starter" | "unlimited" | "already_counted" | "existing_version";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function formatCycleDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return new Date(iso).toLocaleDateString(undefined, opts);
}

/** One sentence about the monthly credit: ready (and when it expires) or when the next one arrives. */
export function monthlyHint(s: CreditStatus, fmt: (iso: string) => string = formatCycleDate): string {
  const date = fmt(s.nextCycleAt);
  if (s.monthly > 0) return `Ready now. Use it by ${date}; it doesn't roll over.`;
  if (!s.monthlyEligible) return `Your first free monthly bid arrives ${date}.`;
  return `Used this cycle. Your next one arrives ${date}.`;
}

/** Message shown after a successful export. */
export function exportMessage(source: CreditSource, versionNumber: number, after: { starter: number; monthly: number; unlimited: boolean }): string {
  switch (source) {
    case "monthly":
      return `Bid finalized with your free monthly bid. ${plural(after.starter, "starter credit")} left.`;
    case "starter":
      return `Bid finalized with 1 starter credit. ${plural(after.starter, "starter credit")} left${after.monthly ? " plus your monthly bid" : ""}.`;
    case "already_counted":
      return `Version ${versionNumber} exported. Updates to a finalized bid are always free.`;
    case "existing_version":
      return `Re-downloaded version ${versionNumber}. No credit used.`;
    default:
      return `Proposal version ${versionNumber} exported.`;
  }
}
