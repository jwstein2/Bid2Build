/**
 * Enterprise pricing, in integer cents. One central calculation used by the pricing page, the seat
 * change preview, and the Stripe price check, so the number a company sees is the number billed.
 *
 * $49.99/month includes 3 licensed users. Extra users are priced on GRADUATED tiers by the user's
 * position in the total headcount (no retroactive discount on earlier seats):
 *   users 4-5   $19.99 each
 *   users 6-10  $17.99 each (10% off)
 *   users 11+   $15.99 each (20% off)
 *
 * Stripe model (Phase 2): one subscription with two items. A flat base price ($49.99, quantity 1) and
 * a graduated tiered seat price whose quantity is (total users - 3), with tiers up_to 2 -> 1999,
 * up_to 7 -> 1799, inf -> 1599. ENTERPRISE_SEAT_TIERS below is exactly that tier table.
 */
export const ENTERPRISE_BASE_CENTS = 4999;
export const ENTERPRISE_INCLUDED_USERS = 3;
export const ENTERPRISE_MAX_USERS = 10_000;

/** Tiers for the additional-seat price, in Stripe's terms (quantity = users beyond the included 3). */
export const ENTERPRISE_SEAT_TIERS = [
  { upTo: 2, unitCents: 1999, firstUser: 4 },
  { upTo: 7, unitCents: 1799, firstUser: 6 },
  { upTo: null, unitCents: 1599, firstUser: 11 },
] as const;

export type EnterpriseLine = { label: string; users: number; unitCents: number; totalCents: number };
export type EnterpriseQuote = { totalUsers: number; extraSeats: number; lines: EnterpriseLine[]; monthlyCents: number; annualizedCents: number };

export function assertUserCount(totalUsers: number): void {
  if (!Number.isInteger(totalUsers) || totalUsers < 1 || totalUsers > ENTERPRISE_MAX_USERS) {
    throw new RangeError(`totalUsers must be an integer between 1 and ${ENTERPRISE_MAX_USERS}`);
  }
}

/** Itemized monthly price for a company with `totalUsers` licensed users (1-3 all cost the base price). */
export function enterpriseQuote(totalUsers: number): EnterpriseQuote {
  assertUserCount(totalUsers);
  const extraSeats = Math.max(0, totalUsers - ENTERPRISE_INCLUDED_USERS);
  const lines: EnterpriseLine[] = [
    {
      label: `Enterprise base (includes ${ENTERPRISE_INCLUDED_USERS} users)`,
      users: Math.min(totalUsers, ENTERPRISE_INCLUDED_USERS),
      unitCents: ENTERPRISE_BASE_CENTS,
      totalCents: ENTERPRISE_BASE_CENTS,
    },
  ];
  let remaining = extraSeats;
  let prevUpTo = 0;
  for (const t of ENTERPRISE_SEAT_TIERS) {
    if (remaining <= 0) break;
    const cap = t.upTo === null ? remaining : t.upTo - prevUpTo;
    const n = Math.min(remaining, cap);
    const last = t.firstUser + n - 1;
    lines.push({ label: `Users ${t.firstUser}${n > 1 ? `-${last}` : ""}`, users: n, unitCents: t.unitCents, totalCents: n * t.unitCents });
    remaining -= n;
    if (t.upTo !== null) prevUpTo = t.upTo;
  }
  const monthlyCents = lines.reduce((s, l) => s + l.totalCents, 0);
  return { totalUsers, extraSeats, lines, monthlyCents, annualizedCents: monthlyCents * 12 };
}

export const enterpriseMonthlyCents = (totalUsers: number) => enterpriseQuote(totalUsers).monthlyCents;

/** Price of the next seat for a company currently at `totalUsers` users. */
export function nextSeatCents(totalUsers: number): number {
  return enterpriseMonthlyCents(totalUsers + 1) - enterpriseMonthlyCents(totalUsers);
}

/** "$1,619.02" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

type StripeTierLike = { up_to: number | null; unit_amount: number | null; flat_amount: number | null };
type StripeEnterprisePriceLike = {
  active?: boolean;
  currency: string;
  unit_amount: number | null;
  billing_scheme?: string | null;
  tiers_mode?: string | null;
  tiers?: StripeTierLike[] | null;
  recurring: { interval: string; interval_count: number; usage_type?: string } | null;
};

function recurringMonthly(p: StripeEnterprisePriceLike): string | null {
  if (p.active === false) return "price is archived";
  if (p.currency !== "usd") return `currency ${p.currency} != usd`;
  if (!p.recurring || p.recurring.interval !== "month" || p.recurring.interval_count !== 1) return "price is not billed monthly";
  if (p.recurring.usage_type && p.recurring.usage_type !== "licensed") return "price is metered, not per-seat";
  return null;
}

/** Reason the configured Stripe base price differs from ENTERPRISE_BASE_CENTS, or null. */
export function enterpriseBaseMismatch(p: StripeEnterprisePriceLike): string | null {
  return recurringMonthly(p) ?? (p.unit_amount !== ENTERPRISE_BASE_CENTS ? `amount ${p.unit_amount} != ${ENTERPRISE_BASE_CENTS}` : null);
}

/** Reason the configured Stripe seat price (retrieved with expand: ["tiers"]) differs from ENTERPRISE_SEAT_TIERS, or null. */
export function enterpriseSeatMismatch(p: StripeEnterprisePriceLike): string | null {
  const base = recurringMonthly(p);
  if (base) return base;
  if (p.billing_scheme !== "tiered" || p.tiers_mode !== "graduated") return "seat price must be tiered + graduated";
  const tiers = p.tiers ?? [];
  if (tiers.length !== ENTERPRISE_SEAT_TIERS.length) return `expected ${ENTERPRISE_SEAT_TIERS.length} tiers, got ${tiers.length}`;
  for (let i = 0; i < tiers.length; i++) {
    const want = ENTERPRISE_SEAT_TIERS[i];
    const got = tiers[i];
    if (got.up_to !== want.upTo || got.unit_amount !== want.unitCents || (got.flat_amount ?? 0) !== 0) {
      return `tier ${i + 1} is ${got.up_to ?? "inf"}@${got.unit_amount}+${got.flat_amount ?? 0}, expected ${want.upTo ?? "inf"}@${want.unitCents}`;
    }
  }
  return null;
}
