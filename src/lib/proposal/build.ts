import { computeEstimate, effectiveVisibility, itemsForGroup, sortedGroups } from "../estimate/engine";
import { D, formatCurrency, round2, toDec } from "../estimate/money";
import type { Estimate } from "../estimate/types";
import { tradeName } from "../trades/catalog";
import type { BusinessProfile, ProposalConfig, ProposalDocument, ProposalSection } from "./types";

const clean = (s?: string | null) => (s && s.trim() ? s.trim() : undefined);

function fmtQty(q: string): string {
  const d = toDec(q).value;
  return d.toDecimalPlaces(4).toString();
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

/**
 * Build the canonical customer-facing proposal. This function is the ONLY bridge between
 * internal estimate data and anything a customer sees, so confidentiality is enforced here:
 * it reads only prices from computeEstimate() and never copies costs, rules, or notes marked internal.
 */
export function buildProposal(estimate: Estimate, business: BusinessProfile, config: ProposalConfig): ProposalDocument {
  const totals = computeEstimate(estimate);
  const show = config.show;

  const contact: { label: string; value: string }[] = [];
  if (show.phone && clean(business.phone)) contact.push({ label: "Phone", value: business.phone!.trim() });
  if (show.email && clean(business.email)) contact.push({ label: "Email", value: business.email!.trim() });
  if (show.website && clean(business.website)) contact.push({ label: "Web", value: business.website!.trim() });
  if (show.address && clean(business.address)) contact.push({ label: "Address", value: business.address!.trim() });
  if (show.license && clean(business.licenseNumber)) contact.push({ label: "License", value: business.licenseNumber!.trim() });

  const sections: ProposalSection[] = [];
  if (estimate.displayMode === "by_group") {
    for (const g of sortedGroups(estimate)) {
      const gt = totals.groups[g.id];
      if (!gt || gt.itemCount === 0) continue;
      const mode = effectiveVisibility(g, estimate);
      const visibleItems = itemsForGroup(estimate, g.id).filter((i) => i.showOnProposal && totals.items[i.id]);
      const section: ProposalSection = {
        title: g.name.trim() || "Untitled section",
        description: show.itemDescriptions ? clean(g.description) : undefined,
        mode,
        amount: show.groupPrices || mode === "group_total" ? formatCurrency(gt.price) : undefined,
        lines: [],
      };
      if (mode !== "group_total") {
        section.lines = visibleItems.map((i) => {
          const t = totals.items[i.id];
          return {
            name: i.name.trim() || "Item",
            description: show.itemDescriptions ? clean(i.description) : undefined,
            notes: show.notes ? clean(i.notes) : undefined,
            ...(mode === "itemized"
              ? {
                  quantity: show.quantities ? fmtQty(i.quantity) : undefined,
                  unit: show.quantities ? i.unit : undefined,
                  unitPrice: show.itemPrices && show.quantities ? formatCurrency(t.unitPrice) : undefined,
                  amount: show.itemPrices ? formatCurrency(t.extendedPrice) : undefined,
                }
              : {}),
          };
        });
      }
      sections.push(section);
    }
  }

  const adjLabel = clean(estimate.adjustmentLabel) ?? (totals.adjustment.isNegative() ? "Discount" : "Adjustment");
  const total = totals.total;
  const milestones = config.paymentSchedule.filter((m) => clean(m.label) || toDec(m.percent).value.gt(0));
  let allocated = new D(0);
  const paymentSchedule = milestones.map((m, idx) => {
    const pct = toDec(m.percent).value;
    // Last milestone absorbs rounding so the schedule sums exactly to the total when percents sum to 100.
    const pctSum = milestones.reduce((s, x) => s.plus(toDec(x.percent).value), new D(0));
    const isLast = idx === milestones.length - 1;
    const amt = isLast && pctSum.eq(100) ? total.minus(allocated) : round2(total.times(pct).div(100));
    allocated = allocated.plus(amt);
    return { label: m.label.trim() || `Payment ${idx + 1}`, percent: pct.toString(), amount: formatCurrency(amt) };
  });

  return {
    template: config.template,
    brand: {
      companyName: business.companyName.trim() || "Your Company",
      tagline: clean(business.tagline),
      logoUrl: business.logoUrl ?? null,
      primaryColor: business.primaryColor,
      secondaryColor: business.secondaryColor,
      logoLayout: business.logoLayout,
      headerStyle: business.headerStyle,
      contact,
    },
    customer: {
      name: estimate.customer.name.trim() || "Customer",
      email: clean(estimate.customer.email),
      phone: clean(estimate.customer.phone),
      projectAddress: clean(estimate.customer.projectAddress),
    },
    meta: {
      title: estimate.title.trim() || "Project Proposal",
      number: estimate.estimateNumber,
      date: fmtDate(estimate.estimateDate),
      expires: fmtDate(estimate.expirationDate),
      trades: estimate.trades.map(tradeName),
    },
    introduction: clean(config.introduction),
    scopeOfWork: clean(config.scopeOfWork),
    pricing: {
      displayMode: estimate.displayMode,
      sections,
      projectLabel: estimate.title.trim() || "Entire Project",
      adjustment:
        !totals.adjustment.isZero() && estimate.displayMode === "by_group"
          ? { label: adjLabel, amount: formatCurrency(totals.adjustment) }
          : undefined,
      subtotal: formatCurrency(totals.subtotal),
      tax: totals.tax.isZero() ? undefined : { label: `Sales tax (${totals.taxRate.toString()}%)`, amount: formatCurrency(totals.tax) },
      total: formatCurrency(total),
    },
    exclusions: clean(config.exclusions),
    allowances: clean(config.allowances),
    customerResponsibilities: clean(config.customerResponsibilities),
    schedule: clean(config.schedule),
    paymentSchedule,
    terms: clean(config.terms),
    signature: config.showSignature,
    footer: [business.companyName.trim(), show.phone ? clean(business.phone) : undefined, show.website ? clean(business.website) : undefined]
      .filter(Boolean)
      .join("  ·  "),
  };
}
