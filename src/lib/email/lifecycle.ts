/**
 * Lifecycle (onboarding) emails A-E: who gets which email, and the copy. Pure functions (no I/O),
 * shared by the daily job (lifecycle-run.ts), the previews and tests. Rules: docs/growth/LIFECYCLE_EMAILS.md.
 *
 *   A  Signed up 24h+ ago, no bid yet (within 7 days of signup).
 *   B  Started a bid, left it 48h+ without 3 priced items (within 14 days of signup).
 *   C  Has a bid with 3+ priced items, never downloaded or sent it, 24h+ later (within 14 days).
 *   D  Delivered a bid on the Free plan 3+ days ago. Upgrade email: marketing opt-in required.
 *   E  Paying 7+ days. Adoption tips only, no upsell.
 *
 * Owner decision (2026-11-16): product-help emails (A, B, C, E) go to all new accounts with a
 * one-click unsubscribe; the upgrade email (D) only to accounts that opted in to marketing.
 *
 * Suppression, always: unsubscribed, bounced/complained/suppressed address, internal/test/demo
 * accounts (live mode), anything already sent for that step, and anything within 48h of the last
 * lifecycle email. Paying accounts never get A-D. Complimentary access is never treated as paying
 * (no E) and never gets the upgrade email (no D). Emails never contain customer names, prices or
 * addresses: they link into the signed-in app instead.
 */
import type { AccountClass } from "@/lib/admin/classify";
import { tradeSeeds } from "@/lib/trades/data";

export const LIFECYCLE_STEPS = ["a", "b", "c", "d", "e"] as const;
export type LifecycleStep = (typeof LIFECYCLE_STEPS)[number];
export const kindOf = (s: LifecycleStep) => `lifecycle_${s}` as const;
export const stepOfKind = (k: string): LifecycleStep | null => {
  const m = /^lifecycle_([a-e])$/.exec(k);
  return m ? (m[1] as LifecycleStep) : null;
};

const H = 3_600_000, D = 24 * H;
/** Minimum gap between two lifecycle emails to the same account. */
export const MIN_GAP_MS = 48 * H;

export interface LifecycleEstimate {
  id: string;
  trade: string | null;
  updatedAt: string;
  /** When it first had 3+ meaningful items, or null. */
  meaningfulAt: string | null;
}

export interface LifecycleFacts {
  userId: string;
  email: string | null;
  createdAt: string;
  cls: AccountClass;
  unsubscribed: boolean;
  /** Address suppressed in leads (bounced, complaint, unsubscribed, manual, deleted account). */
  suppressed: boolean;
  marketingOptIn: boolean;
  /** Paid subscription in good standing, and since when. Complimentary access is NOT paying. */
  payingSince: string | null;
  complimentary: boolean;
  estimates: LifecycleEstimate[];
  /** First finalized export or signing link, or null. */
  firstDeliveredAt: string | null;
  /** Trade slug from the first landing page (/bids/<slug> or /start/<slug>), if any. */
  landingTrade: string | null;
  /** Lifecycle steps already recorded for this account (any status) and the latest send time. */
  done: LifecycleStep[];
  lastSentAt: string | null;
}

export interface LifecyclePlan { step: LifecycleStep; estimateId: string | null; trade: string | null }

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const age = (iso: string | null | undefined, now: number) => now - ms(iso);
const between = (iso: string | null | undefined, now: number, min: number, max: number) => { const a = age(iso, now); return Number.isFinite(a) && a >= min && a <= max; };

/**
 * The one email (if any) this account should get now. `allowNonGenuine` is for test mode, where only
 * the owner's own (internal) test addresses are ever considered.
 */
export function planLifecycle(f: LifecycleFacts, now = Date.now(), opts: { allowNonGenuine?: boolean } = {}): LifecyclePlan | null {
  if (!f.email || f.unsubscribed || f.suppressed) return null;
  if (f.cls !== "genuine" && !opts.allowNonGenuine) return null;
  if (f.lastSentAt && age(f.lastSentAt, now) < MIN_GAP_MS) return null;
  const done = new Set(f.done);
  const paying = Boolean(f.payingSince);
  const delivered = Boolean(f.firstDeliveredAt);
  const byRecent = [...f.estimates].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  const meaningful = byRecent.filter((e) => e.meaningfulAt);

  if (paying) {
    if (!done.has("e") && between(f.payingSince, now, 7 * D, 30 * D)) return { step: "e", estimateId: null, trade: byRecent[0]?.trade ?? f.landingTrade };
    return null;
  }
  // C: priced a bid but never downloaded or sent it.
  if (!delivered && meaningful.length && !done.has("c") && between(f.createdAt, now, 0, 14 * D)) {
    const first = [...meaningful].sort((a, b) => ms(a.meaningfulAt) - ms(b.meaningfulAt))[0];
    if (age(first.meaningfulAt, now) >= 24 * H && age(byRecent[0].updatedAt, now) >= 24 * H) return { step: "c", estimateId: meaningful[0].id, trade: meaningful[0].trade };
  }
  // B: started a bid, left it unfinished.
  if (!delivered && !meaningful.length && byRecent.length && !done.has("b") && between(f.createdAt, now, 0, 14 * D) && age(byRecent[0].updatedAt, now) >= 48 * H) {
    return { step: "b", estimateId: byRecent[0].id, trade: byRecent[0].trade };
  }
  // A: no bid yet.
  if (!byRecent.length && !done.has("a") && between(f.createdAt, now, 24 * H, 7 * D)) return { step: "a", estimateId: null, trade: f.landingTrade };
  // D: delivered on Free. Promotional: opt-in only, never complimentary accounts.
  if (delivered && f.marketingOptIn && !f.complimentary && !done.has("d") && between(f.firstDeliveredAt, now, 3 * D, 30 * D)) {
    return { step: "d", estimateId: null, trade: byRecent[0]?.trade ?? f.landingTrade };
  }
  return null;
}

/** Trade slug from a first-touch landing path, if it names a known trade. */
export function tradeFromPath(path: string | null | undefined): string | null {
  const m = /^\/(?:bids|start)\/([a-z0-9-]+)/.exec(path ?? "");
  return m && tradeSeeds.some((t) => t.slug === m[1]) ? m[1] : null;
}

export function tradeName(slug: string | null | undefined): string | null {
  return tradeSeeds.find((t) => t.slug === slug)?.name ?? null;
}

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------
export interface Rendered { subject: string; text: string; html: string }
export interface CopyContext {
  appUrl: string;
  step: LifecycleStep;
  trade: string | null;
  estimateId: string | null;
  unsubscribeUrl: string;
  postalAddress: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(paragraphs: string[], cta: { href: string; label: string }, footer: string[], unsubscribeUrl: string): string {
  const p = (t: string) => `<p style="margin:0 0 16px">${esc(t)}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#1a2433;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55">
<div style="max-width:560px">
<p style="margin:0 0 20px;font-weight:800;font-size:20px;color:#14284b">Built2Bid</p>
${paragraphs.map(p).join("\n")}
<p style="margin:24px 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#f26b1d;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${esc(cta.label)}</a></p>
<p style="margin:24px 0 0;font-size:13px;color:#5b6675">${footer.map(esc).join("<br>")}<br><a href="${esc(unsubscribeUrl)}" style="color:#5b6675">Unsubscribe from these emails</a></p>
</div></body></html>`;
}

export const SUBJECTS: Record<LifecycleStep, (trade: string | null) => string> = {
  a: () => "Ready to create your first professional bid?",
  b: (t) => (t ? `Your ${t} estimate is ready when you are` : "Your estimate is ready when you are"),
  c: () => "Your bid is priced. Here's how to send it.",
  d: () => "You've sent your first bid. Here's what Unlimited adds.",
  e: () => "Three Built2Bid features worth setting up",
};

export function renderLifecycle(c: CopyContext): Rendered {
  const base = c.appUrl.replace(/\/+$/, "");
  const name = tradeName(c.trade);
  const bid = c.estimateId ? `${base}/estimates/${c.estimateId}` : `${base}/bids`;
  let paras: string[];
  let cta: { href: string; label: string };
  switch (c.step) {
    case "a":
      paras = [
        "Thanks for signing up for Built2Bid.",
        name
          ? `When you're ready, pick ${name} and your estimate opens with the usual sections already in place. Add your quantities and costs, and the calculators can work out quantities from your measurements.`
          : "When you're ready, pick your trade and your estimate opens with the usual sections already in place. Add your quantities and costs, and the calculators can work out quantities from your measurements.",
        "Your costs and markup stay private. Your customer only sees the proposal.",
        "Reply to this email if you get stuck. A real person reads every reply.",
      ];
      cta = { href: c.trade ? `${base}/start/${c.trade}` : `${base}/bids`, label: "Create my first bid" };
      break;
    case "b":
      paras = [
        `You started ${name ? `an estimate for ${name}` : "an estimate"} in Built2Bid. It's saved right where you left it.`,
        "Price at least three line items with your own quantities and costs, then preview the proposal to see exactly what your customer will see.",
        "If a measurement is slowing you down, open the calculator on the line item. It turns measurements into quantities.",
      ];
      cta = { href: bid, label: "Continue my estimate" };
      break;
    case "c":
      paras = [
        "Your bid has its line items priced. The last step is getting it to your customer.",
        "Open the proposal step to choose how much detail they see: every line with its price, item names only, section totals, or just the project total. Your costs and markup are never shown.",
        "Then download a branded PDF, or send it for e-signature so your customer can sign online.",
      ];
      cta = { href: c.estimateId ? `${bid}?step=proposal` : bid, label: "Preview my proposal" };
      break;
    case "d":
      paras = [
        "Nice work getting your first bid out the door with Built2Bid.",
        "If you're bidding regularly, Unlimited removes the bid limit and adds Saved Items & Pricing, so your usual materials and labor rates are one tap away, plus Proposal Templates for your standard terms.",
        "It's optional. The Free plan keeps working and your bids stay where they are.",
      ];
      cta = { href: `${base}/pricing`, label: "See plans" };
      break;
    case "e":
      paras = [
        "Thanks for being a Built2Bid subscriber. Three things worth setting up if you haven't yet:",
        "1. Saved Items & Pricing: save the materials and labor rates you use on every job.",
        "2. Proposal Templates: keep your standard terms, exclusions and warranty text in one place.",
        "3. E-signature: send a bid for signature, and it shows on your dashboard once your customer signs.",
        "Reply to this email with anything that would make bidding faster for you.",
      ];
      cta = { href: `${base}/dashboard`, label: "Open Built2Bid" };
      break;
  }
  const footer = [
    c.step === "d" ? "You're getting this because you opted in to Built2Bid product news." : "You're getting this because you have a Built2Bid account.",
    `Built2Bid · ${c.postalAddress}`,
  ];
  const subject = SUBJECTS[c.step](name);
  return {
    subject,
    text: [...paras, `${cta.label}: ${cta.href}`, ...footer, `Unsubscribe: ${c.unsubscribeUrl}`].join("\n\n") + "\n",
    html: layout(paras, cta, footer, c.unsubscribeUrl),
  };
}
