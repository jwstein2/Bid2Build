/**
 * Nurture follow-up emails: grounded only in saved facts. The template has a fixed set of
 * placeholders; anything else is refused when the template is saved. Nothing here invents a
 * conversation, promise, discount or project detail, and no text says a previous quote still stands.
 */
import { tradeName } from "@/lib/trades/catalog";
import type { AudienceEntry } from "./eligibility";
import type { Offer } from "./types";

import { PLACEHOLDERS, DEFAULT_BODY, DEFAULT_SUBJECT, type Placeholder } from "./template";
export { PLACEHOLDERS, PLACEHOLDER_HELP, DEFAULT_BODY, DEFAULT_SUBJECT, type Placeholder } from "./template";

/** Phrases that would promise a price or claim a history we can't verify. */
const BLOCKED = [
  /\b(still|remains?)\s+(valid|good|available)\b/i, /\bhonou?r\s+(the|your|our)\s+(original|previous|old)?\s*(quote|price|estimate)\b/i,
  /\bsame\s+price\b/i, /\bprice\s+(lock|guarantee)/i, /\bguarantee[ds]?\b/i, /\bas (we|you) discussed\b/i, /\bper our (conversation|call)\b/i, /\blast time we (spoke|talked)\b/i,
];

export function validateTemplate(subject: string, body: string): string | null {
  if (!subject.trim() || subject.length > 200) return "Add a subject line (up to 200 characters).";
  if (!body.trim() || body.length > 4000) return "Add a message (up to 4,000 characters).";
  for (const m of `${subject}\n${body}`.matchAll(/\{([^{}]*)\}/g)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) return `{${m[1]}} isn't a placeholder we can fill in. Use one of: ${PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`;
  }
  const hit = BLOCKED.find((re) => re.test(`${subject}\n${body}`));
  if (hit) return "Follow-ups can't promise an old price, guarantee anything or refer to conversations we can't verify. Please reword that part.";
  if (/https?:\/\//i.test(body)) return "Links aren't allowed in follow-up templates (they hurt delivery). Customers can reply to the email instead.";
  return null;
}

const NICE: Record<string, string> = { decks: "deck", roofing: "roofing", siding: "siding", painting: "painting", concrete: "concrete", fencing: "fence", remodeling: "remodeling" };
export function projectType(trades: string[], title: string): string {
  const t = trades[0];
  if (t) return NICE[t] ?? tradeName(t).toLowerCase();
  const clean = title.trim().replace(/\s+/g, " ");
  return clean && clean.length <= 40 ? clean.toLowerCase() : "home improvement";
}
export const firstName = (name: string) => {
  const f = name.trim().split(/\s+/)[0]?.replace(/[,;.]+$/, "") ?? "";
  return /^[\p{L}'-]{2,30}$/u.test(f) ? f : "";
};
export function monthYear(ymd: string): string {
  return new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface NurtureContext { companyName: string; senderName: string; postalAddress: string; unsubscribeUrl: string; today: string }

export function renderTemplate(tpl: string, entry: Pick<AudienceEntry, "name" | "estimate">, ctx: Pick<NurtureContext, "companyName" | "senderName">): string {
  const type = projectType(entry.estimate.trades, entry.estimate.title);
  const month = monthYear(entry.estimate.estimateDate);
  const values: Record<Placeholder, string> = {
    first_name: firstName(entry.name),
    company_name: ctx.companyName,
    sender_name: ctx.senderName || ctx.companyName,
    project_type: type,
    project_reference: `the ${type} project we ${entry.estimate.completed ? "completed" : "quoted"} for you back in ${month}`,
    estimate_month: month,
  };
  return tpl.replace(/\{([a-z_]+)\}/g, (_, k: string) => values[k as Placeholder] ?? "")
    .replace(/^Hi ,/m, "Hi,").replace(/[ \t]+\n/g, "\n");
}

/** Plain, non-guaranteeing wording for an approved offer (null when the offer can't be described honestly). */
export function offerText(o: Offer): string | null {
  const window = `Offer valid ${fmt(o.startsOn)} – ${fmt(o.endsOn)}.`;
  const cond = o.conditions.trim() ? ` ${o.conditions.trim().replace(/\.?$/, ".")}` : "";
  const extra = o.message.trim() ? `${o.message.trim().replace(/\.?$/, ".")} ` : "";
  switch (o.offerType) {
    case "percent": return o.discountValue ? `${extra}${o.name}: ${trimNum(o.discountValue)}% off. ${window}${cond}` : null;
    case "fixed": return o.discountValue ? `${extra}${o.name}: $${trimNum(o.discountValue)} off. ${window}${cond}` : null;
    case "material": {
      if (!o.comparisonApprovedAt || !o.materialCurrent || !o.materialAlternative || !o.priceBasis) return null;
      const basis = o.priceBasis === "verified" ? "current supplier pricing" : "our own estimate";
      const savings = o.estimatedSavings?.trim() ? ` (estimated difference: ${o.estimatedSavings.trim()})` : "";
      return `${extra}We can also price the work with ${o.materialAlternative} instead of ${o.materialCurrent}. Based on ${basis}, that may lower the cost${savings}. Actual pricing depends on your project, and we'd walk you through the differences in look, durability and warranty before you decide. ${window}${cond}`;
    }
    case "financing": return o.message.trim() ? `${o.message.trim().replace(/\.?$/, ".")} Financing is subject to approval. ${window}${cond}` : null;
    default: return o.message.trim() ? `${o.message.trim().replace(/\.?$/, ".")} ${window}${cond}` : null;
  }
}
const trimNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The offer to include, if any: active, in its date window, for this trade and audience, comparison approved. */
export function pickOffer(offers: Offer[], entry: Pick<AudienceEntry, "groups" | "estimate">, today: string): Offer | null {
  return offers.find((o) => o.active && o.startsOn <= today && today <= o.endsOn
    && (!o.trades.length || o.trades.some((t) => entry.estimate.trades.includes(t)))
    && (!o.audience.length || o.audience.some((g) => entry.groups.includes(g)))
    && (o.offerType !== "material" || Boolean(o.comparisonApprovedAt))
    && offerText(o) !== null) ?? null;
}

export function footer(ctx: Pick<NurtureContext, "companyName" | "postalAddress" | "unsubscribeUrl">, reason: string): string {
  return ["", "--", `${ctx.companyName} · ${ctx.postalAddress}`, reason, `Don't want these follow-ups? Unsubscribe: ${ctx.unsubscribeUrl}`].join("\n");
}

export interface RenderedNurture { subject: string; body: string; offerId: string | null; facts: Record<string, unknown> }

export function renderNurture(entry: AudienceEntry, opts: { subject: string | null; body: string | null; offers: Offer[]; includeOffers: boolean; ctx: NurtureContext }): RenderedNurture {
  const offer = opts.includeOffers ? pickOffer(opts.offers, entry, opts.ctx.today) : null;
  let body = renderTemplate(opts.body || DEFAULT_BODY, entry, opts.ctx);
  if (offer) {
    const text = offerText(offer)!;
    // Offer goes right before the sign-off ("No pressure..." / "Thanks,") when we can find it.
    const at = body.search(/\n(No pressure|Thanks|Thank you|Best|Regards)/i);
    body = at > 0 ? `${body.slice(0, at)}\n${text}\n${body.slice(at)}` : `${body}\n\n${text}`;
  }
  const reason = entry.estimate.completed ? `You're receiving this because ${opts.ctx.companyName} worked on a project for you.` : `You're receiving this because you requested an estimate from ${opts.ctx.companyName}.`;
  body = `${body.trim()}\n${footer(opts.ctx, reason)}`;
  return {
    subject: renderTemplate(opts.subject || DEFAULT_SUBJECT, entry, opts.ctx).trim().slice(0, 300),
    body,
    offerId: offer?.id ?? null,
    facts: { customerName: entry.name, estimateId: entry.estimate.id, estimateTitle: entry.estimate.title, estimateDate: entry.estimate.estimateDate, stage: entry.estimate.stage, trades: entry.estimate.trades, groups: entry.groups, offer: offer ? { id: offer.id, name: offer.name } : null },
  };
}

export function validateOffer(o: Partial<Offer>): string | null {
  if (!o.name?.trim()) return "Give the offer a name.";
  if (!o.startsOn || !o.endsOn || o.endsOn < o.startsOn) return "Set a start date and an end date after it.";
  if ((o.offerType === "percent" || o.offerType === "fixed") && !(Number(o.discountValue) > 0)) return "Enter the discount amount.";
  if (o.offerType === "percent" && Number(o.discountValue) > 50) return "Percentage discounts over 50% aren't allowed here.";
  if (o.offerType === "material" && (!o.materialCurrent?.trim() || !o.materialAlternative?.trim() || !o.priceBasis)) return "Pick the current material, the alternative and where the price comparison comes from.";
  if ((o.offerType === "seasonal" || o.offerType === "custom" || o.offerType === "financing") && !o.message?.trim()) return "Write the offer message customers will see.";
  const all = `${o.message ?? ""} ${o.conditions ?? ""} ${o.estimatedSavings ?? ""}`;
  if (/\bguarantee|\bsame (quality|performance)|\bjust as good\b/i.test(all)) return "Offers can't guarantee savings or equal performance. Please reword.";
  return null;
}
