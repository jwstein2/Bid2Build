/**
 * PM (project scheduling) add-on pricing and Stripe item rules. Pure: shared by the billing APIs,
 * the webhook sync and tests.
 *
 *   Standard Unlimited: optional add-on, $4.99/month, one scheduling editor. Added as a subscription
 *   item on the existing Unlimited subscription (Stripe requires every item on a subscription to bill
 *   on the same interval, so annual plans need a yearly add-on price; until one is configured the
 *   add-on is offered on monthly plans only).
 *   Enterprise: one editor included; extra editors $1.99/month each, one item whose quantity is the
 *   number of extra editors. Separate from licensed users.
 *
 * Removal: the Standard add-on is removed with no proration and editing stays on until the end of the
 * paid period; Enterprise extra editors are removed immediately with a prorated credit, exactly like
 * licensed users.
 */
export const PM_ADDON_CENTS = 499;
export const PM_EDITOR_CENTS = 199;
export const PM_INCLUDED_ENTERPRISE_EDITORS = 1;
export const PM_MAX_EXTRA_EDITORS = 1000;

export type PmPrices = { addonMonthly?: string; addonAnnual?: string; editor?: string };
export type PmItem = { id: string; price: { id: string; recurring?: { interval?: string } | null }; quantity?: number | null };
export type ItemUpdate = { id?: string; price?: string; quantity?: number; deleted?: boolean };

export const isPmPrice = (priceId: string | undefined | null, p: PmPrices) =>
  Boolean(priceId && (priceId === p.addonMonthly || priceId === p.addonAnnual || priceId === p.editor));

/** What the subscription says about PM. */
export function pmFromItems(items: PmItem[], p: PmPrices): { addon: boolean; extraEditors: number } {
  const addon = items.some((i) => i.price?.id && (i.price.id === p.addonMonthly || i.price.id === p.addonAnnual));
  const editors = items.find((i) => p.editor && i.price?.id === p.editor)?.quantity ?? 0;
  return { addon, extraEditors: Math.max(0, editors) };
}

/** Billing interval of the subscription's plan item (not a PM item). */
export function planInterval(items: PmItem[], p: PmPrices): "month" | "year" | null {
  const base = items.find((i) => !isPmPrice(i.price?.id, p));
  const iv = base?.price?.recurring?.interval;
  return iv === "month" || iv === "year" ? iv : null;
}

/** The add-on price that matches this subscription's interval, or why it can't be added. */
export function addonPriceFor(items: PmItem[], p: PmPrices): { price: string } | { error: "annual_unavailable" | "not_configured" | "unknown_interval" } {
  const iv = planInterval(items, p);
  if (iv === "month") return p.addonMonthly ? { price: p.addonMonthly } : { error: "not_configured" };
  if (iv === "year") return p.addonAnnual ? { price: p.addonAnnual } : { error: "annual_unavailable" };
  return { error: "unknown_interval" };
}

export function addonItemUpdates(items: PmItem[], p: PmPrices, on: boolean): ItemUpdate[] | { error: string } {
  const existing = items.find((i) => i.price?.id && (i.price.id === p.addonMonthly || i.price.id === p.addonAnnual));
  if (on) {
    if (existing) return [];
    const pr = addonPriceFor(items, p);
    return "error" in pr ? pr : [{ price: pr.price, quantity: 1 }];
  }
  return existing ? [{ id: existing.id, deleted: true }] : [];
}

export function editorItemUpdates(items: PmItem[], p: PmPrices, extra: number): ItemUpdate[] {
  const item = items.find((i) => p.editor && i.price?.id === p.editor);
  if (item) return [extra > 0 ? { id: item.id, quantity: extra } : { id: item.id, deleted: true }];
  return extra > 0 && p.editor ? [{ price: p.editor, quantity: extra }] : [];
}

export type EditorCheck = { ok: true } | { ok: false; code: "invalid" | "unchanged" | "below_assigned"; message: string };

/** Can the company move to `extra` paid editors, with `assigned` editors currently assigned? */
export function checkEditorTarget(extra: number, current: number, assigned: number, compLimit = 0): EditorCheck {
  if (!Number.isInteger(extra) || extra < 0 || extra > PM_MAX_EXTRA_EDITORS) return { ok: false, code: "invalid", message: `Choose between 0 and ${PM_MAX_EXTRA_EDITORS} extra editors.` };
  if (extra === current) return { ok: false, code: "unchanged", message: "That's your current number of editors." };
  const limit = Math.max(PM_INCLUDED_ENTERPRISE_EDITORS + extra, compLimit);
  if (limit < assigned) return { ok: false, code: "below_assigned", message: `${assigned} people are assigned as schedule editors. Remove editors before going below ${assigned}.` };
  return { ok: true };
}

export const editorMonthlyCents = (extra: number) => Math.max(0, extra) * PM_EDITOR_CENTS;

type PriceLike = { active?: boolean; currency: string; unit_amount: number | null; recurring: { interval: string; interval_count: number; usage_type?: string } | null };

/** Why a configured Stripe price differs from what we charge, or null. */
export function pmPriceMismatch(p: PriceLike, cents: number, interval: "month" | "year" = "month"): string | null {
  if (p.active === false) return "price is archived";
  if (p.currency !== "usd") return `currency ${p.currency} != usd`;
  if (!p.recurring || p.recurring.interval !== interval || p.recurring.interval_count !== 1) return `price is not billed every ${interval}`;
  if (p.recurring.usage_type && p.recurring.usage_type !== "licensed") return "price is metered";
  if (interval === "month" && p.unit_amount !== cents) return `amount ${p.unit_amount} != ${cents}`;
  return null;
}
