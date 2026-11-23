/**
 * Record previews for the Home summary cards. Pure: they only pick and order records the card already loaded
 * (or a bounded payments read), so headline figures and their calculations are untouched. Unit tested.
 */
import { cmp } from "@/lib/financials/money";
import { FOCUS, type Column } from "@/lib/pipeline/board";
import type { ArRow } from "@/lib/financials/receivables";

/** Records shown under a card: three by default, four on a tall card. */
export const previewCount = (tall: boolean) => (tall ? 4 : 3);

/** Open invoices, most urgent first: overdue before not overdue, then most days overdue, then largest balance. */
export function arPreview(rows: ArRow[], n: number): ArRow[] {
  return [...rows].sort((a, b) =>
    Number(b.days_overdue > 0) - Number(a.days_overdue > 0)
    || b.days_overdue - a.days_overdue
    || cmp(b.balance, a.balance)
    || a.due_date.localeCompare(b.due_date)).slice(0, n);
}

/** Invoice status for a preview row. */
export function arStatus(r: Pick<ArRow, "days_overdue" | "due_date">, today: string, soon: string): { text: string; tone: "danger" | "warn" | "neutral" } {
  if (r.days_overdue > 0) return { text: "Overdue", tone: "danger" };
  if (r.due_date >= today && r.due_date <= soon) return { text: "Due soon", tone: "warn" };
  return { text: "Current", tone: "neutral" };
}

interface BidLike { id: string; column: Column; updatedAt: string; stageAt: string | null; createdAt: string }

/** Draft bids, most recently edited first. */
export function draftPreview<T extends BidLike>(bids: T[], n: number): T[] {
  return bids.filter((b) => b.column === "draft").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, n);
}

const WON = FOCUS.won.columns as readonly Column[];
export const isWon = (c: Column) => WON.includes(c);

/**
 * Recently decided bids (won or lost) from the same set the Win rate counts, newest decision first. The
 * decision time is when the bid last changed stage (falls back to its last edit).
 */
export function decidedPreview<T extends BidLike>(bids: T[], n: number): T[] {
  const at = (b: T) => b.stageAt ?? b.updatedAt;
  return bids.filter((b) => isWon(b.column) || b.column === "lost").sort((a, b) => at(b).localeCompare(at(a))).slice(0, n);
}

export interface VerifiedPayment {
  id: string; number: string; customer: string | null; customerId: string | null; job: string | null; href: string | null;
  amount: string; refunded: string; receivedOn: string; verifiedAt: string; method: string; source: string;
}

/** Status for a verified payment row: refunds are shown, never hidden. */
export function paymentStatus(p: Pick<VerifiedPayment, "amount" | "refunded">): { text: string; tone: "ok" | "warn" | "neutral" } {
  if (cmp(p.refunded, 0) > 0 && cmp(p.refunded, p.amount) >= 0) return { text: "Refunded", tone: "neutral" };
  if (cmp(p.refunded, 0) > 0) return { text: "Part refunded", tone: "warn" };
  return { text: "Verified", tone: "ok" };
}

/** The customer record page (Customer Hub). Null when the record isn't linked to a customer. */
export const customerHref = (id: string | null | undefined): string | undefined =>
  id && /^[0-9a-f-]{36}$/i.test(id) ? `/dashboard/customers/${id}` : undefined;

/** Opens one invoice: the job's billing tab scrolls to Invoices and shows that invoice's preview. */
export const invoiceHref = (estimateId: string, invoiceId: string) => `/financials/jobs/${estimateId}#invoice-${invoiceId}`;
