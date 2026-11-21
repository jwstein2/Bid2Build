/**
 * Credit card surcharges ("customer pays the card fee") on online invoice payments: the decision engine.
 * Pure and unit-tested. The per-state rules and their sources live in surcharge-rules.ts.
 *
 * What a surcharge must satisfy, all at once (strictest wins):
 *  1. State law of BOTH the contractor's business state and the customer's state (card-not-present: we can't be
 *     sure which one governs, so we apply both). Banned or unclear in either → no surcharge.
 *  2. Card network rules: credit cards only (never debit or prepaid, including "credit" chosen as debit), at most 3%
 *     (Visa's cap, the lowest network cap), never more than the merchant's actual cost of accepting the card,
 *     disclosed before payment, shown as its own line, and the merchant notified its acquirer 30 days ahead.
 *  3. The contractor's own chosen rate.
 * The surcharge is AUTHORIZED with the payment but only CAPTURED once Stripe tells us the card is a US credit card
 * billed in a state that allows it; otherwise only the invoice amount is captured (see capturePlan).
 */
import { RULES_VERIFIED_ON, STATE_RULES, type StateRule } from "./surcharge-rules";

/** Visa's cap (lowest of the networks). Mastercard allows up to 4% today; we hold everyone to 3%. */
export const NETWORK_CAP_PCT = 3;
/** Visa: notify the acquirer (Stripe) at least 30 days before surcharging (Mastercard's rule is the same; its registration is paused). */
export const NOTICE_DAYS = 30;
export { RULES_VERIFIED_ON };

export const STATE_CODES = Object.keys(STATE_RULES).sort();
export const stateName = (code: string) => STATE_RULES[code]?.name ?? code;

export function normalizeState(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  const up = t.toUpperCase();
  if (STATE_RULES[up]) return up;
  const byName = Object.entries(STATE_RULES).find(([, r]) => r.name.toLowerCase() === t.toLowerCase());
  return byName ? byName[0] : null;
}

/** Best-effort state from a one-line US address ("12 Oak St, Edina, MN 55424" or "..., Minnesota"). */
export function stateFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const s = addr.replace(/\s+/g, " ").trim().replace(/,?\s*(USA|US|United States)\.?$/i, "");
  const zip = s.match(/(?:^|[\s,])([A-Za-z]{2})\.?\s+\d{5}(?:-\d{4})?$/);
  if (zip) return normalizeState(zip[1]);
  const tail = s.match(/,\s*([A-Za-z .]+?)\s*(?:\d{5}(?:-\d{4})?)?$/);
  return tail ? normalizeState(tail[1]) : null;
}

export interface SurchargeSettings {
  pct: number;              // contractor's chosen surcharge rate, 0..3
  costPct: number;          // contractor's card processing rate, percent (Stripe standard: 2.9)
  costFixedCents: number;   // contractor's per-payment card fee, cents (Stripe standard: 30)
  noticeDate: string | null; // YYYY-MM-DD the contractor notified Stripe / the card networks
  attested: boolean;        // contractor accepted the surcharge terms
}

export interface Decision {
  ok: boolean;
  /** Highest rate allowed here (before the contractor's own rate). */
  maxPct: number;
  /** Rate that applies (min of contractor rate and maxPct), 0 when not ok. */
  pct: number;
  /** Plain-language reasons when not ok (shown to the contractor or, gently, to the customer). */
  reasons: string[];
  /** Extra state-required wording for the customer-facing disclosure. */
  disclosures: string[];
  rules: StateRule[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** May a surcharge be charged between this contractor state and customer state, and at what rate? */
export function surchargeDecision(contractorState: string | null, customerState: string | null, contractorPct = NETWORK_CAP_PCT): Decision {
  const reasons: string[] = [];
  const disclosures: string[] = [];
  const rules: StateRule[] = [];
  let maxPct = NETWORK_CAP_PCT;
  const check = (code: string | null, who: "business" | "customer") => {
    if (!code) {
      reasons.push(who === "business" ? "Add your business state (Financials → Tax) so we can check surcharge rules." : "We need the customer's state to check surcharge rules.");
      return;
    }
    const r = STATE_RULES[code];
    if (!r) { reasons.push(`Card surcharges aren't supported for ${code}.`); return; }
    if (rules.includes(r)) return;
    rules.push(r);
    if (r.status === "banned") reasons.push(`${r.name} doesn't allow credit card surcharges.`);
    else if (r.status === "unclear") reasons.push(`${r.name}'s surcharge rules aren't settled, so we don't add one there.`);
    else {
      if (r.capPct != null) maxPct = Math.min(maxPct, r.capPct);
      if (r.disclosure) disclosures.push(r.disclosure);
    }
  };
  check(contractorState, "business");
  check(customerState, "customer");
  const ok = reasons.length === 0;
  const pct = ok ? round2(Math.max(0, Math.min(contractorPct, maxPct))) : 0;
  return { ok: ok && pct > 0, maxPct: round2(maxPct), pct, reasons, disclosures, rules };
}

/** First day surcharging may start: notice date + 30 days. */
export function noticeReadyOn(noticeDate: string | null): string | null {
  if (!noticeDate || !/^\d{4}-\d{2}-\d{2}$/.test(noticeDate)) return null;
  const d = new Date(`${noticeDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + NOTICE_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Why the contractor's own setup isn't ready to surcharge (empty = ready). */
export function settingsProblems(s: SurchargeSettings, today = new Date().toISOString().slice(0, 10)): string[] {
  const out: string[] = [];
  if (!(s.pct > 0)) out.push("Choose a surcharge rate.");
  if (s.pct > NETWORK_CAP_PCT) out.push(`The surcharge can't be more than ${NETWORK_CAP_PCT}%.`);
  if (!s.attested) out.push("Accept the surcharge terms.");
  const ready = noticeReadyOn(s.noticeDate);
  if (!ready) out.push("Enter the date you told Stripe (your card processor) that you will surcharge.");
  else if (today < ready) out.push(`Visa and Mastercard require 30 days' notice. Surcharging can start on ${ready}.`);
  return out;
}

/**
 * Surcharge in cents for an invoice amount: the contractor's rate, but never more than what the card actually costs
 * them on the surcharged total (Visa / Mastercard / NY / NJ etc. cap surcharges at the cost of acceptance).
 * cost(b + s) = costPct% * (b + s) + fixed  →  s <= (costPct% * b + fixed) / (1 - costPct%).
 */
export function surchargeCents(baseCents: number, pct: number, costPct: number, costFixedCents: number): number {
  if (!(baseCents > 0) || !(pct > 0)) return 0;
  const byRate = Math.floor((baseCents * pct) / 100);
  const c = Math.max(0, costPct) / 100;
  const byCost = c >= 1 ? byRate : Math.floor((c * baseCents + Math.max(0, costFixedCents)) / (1 - c));
  return Math.max(0, Math.min(byRate, byCost));
}

export interface CaptureFacts {
  funding: string | null | undefined;      // charge.payment_method_details.card.funding
  pmType: string | null | undefined;       // charge.payment_method_details.type
  billingState: string | null | undefined; // charge.billing_details.address.state
  billingCountry: string | null | undefined;
}

/**
 * After the customer authorizes base + surcharge: how much to capture. The surcharge is kept only for a credit card,
 * billed in the US, in a state that allows it (checked against the contractor's state too). Anything uncertain
 * (debit, prepaid, unknown funding, wallets that hide funding, missing billing state) drops the surcharge.
 */
export function capturePlan(baseCents: number, surcharge: number, contractorState: string | null, f: CaptureFacts, contractorPct = NETWORK_CAP_PCT) {
  const drop = (why: string) => ({ captureCents: baseCents, keptCents: 0, reason: why });
  if (!(surcharge > 0)) return { captureCents: baseCents, keptCents: 0, reason: null as string | null };
  if (f.pmType !== "card") return drop("Not a card payment, so no surcharge.");
  if (f.funding !== "credit") return drop(f.funding === "debit" || f.funding === "prepaid" ? `No surcharge on ${f.funding} cards.` : "Card type unknown, so no surcharge.");
  if ((f.billingCountry ?? "").toUpperCase() !== "US") return drop("Billing address outside the US, so no surcharge.");
  const d = surchargeDecision(contractorState, normalizeState(f.billingState), contractorPct);
  if (!d.ok) return drop(d.reasons[0] ?? "Surcharge not allowed for this billing state.");
  const allowed = Math.min(surcharge, Math.floor((baseCents * d.pct) / 100));
  return { captureCents: baseCents + allowed, keptCents: allowed, reason: allowed < surcharge ? "Surcharge lowered to the billing state's cap." : null };
}

/** The customer-facing disclosure, shown before payment, on the invoice and on Stripe's checkout page. */
export function disclosureText(pct: number, extra: string[] = []): string {
  const p = `${Number(pct.toFixed(2))}%`;
  return [
    `We add a ${p} surcharge to payments made with a credit card. This is not greater than our cost of accepting credit cards.`,
    "There is no surcharge on debit cards, prepaid cards, or bank (ACH) payments.",
    ...extra,
  ].join(" ");
}
