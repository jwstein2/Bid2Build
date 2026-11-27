/**
 * Shared JSON-LD builders (schema.org). Everything here must match what the page visibly says:
 * no ratings, review counts, awards, customer counts or prices that are not on the page.
 * Prices are read from the billing modules, never typed.
 */
import { ANNUAL, MONTHLY } from "@/lib/billing/plans";
import { PM_PRODUCT_NAME, PRICES, pmMarketedLive } from "@/lib/marketing/catalog";
import { site } from "@/lib/site";

export const ORG_ID = () => `${site.url}/#organization`;

const amount = (label: string) => label.replace(/[$,]/g, "");

/** The Offer list shared by the homepage and the product fact page. */
export function softwareOffers(env?: Record<string, string | undefined>) {
  const offer = (name: string, price: string, unitCode?: "MON" | "ANN") => ({
    "@type": "Offer",
    name,
    price,
    priceCurrency: "USD",
    ...(unitCode ? { priceSpecification: { "@type": "UnitPriceSpecification", price, priceCurrency: "USD", unitCode, referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode } } } : {}),
  });
  return [
    offer("Free", "0"),
    offer("Individual Unlimited Monthly", amount(MONTHLY.price), "MON"),
    offer("Individual Unlimited Annual", amount(ANNUAL.price), "ANN"),
    ...(pmMarketedLive(env) ? [offer(`${PM_PRODUCT_NAME} add-on (monthly)`, amount(PRICES.pmMonthly), "MON")] : []),
    offer(`Team (${PRICES.enterpriseIncludedUsers} users, monthly)`, amount(PRICES.enterpriseBase), "MON"),
  ];
}

export function softwareApplicationLd(opts: { description?: string; url?: string } = {}) {
  return {
    "@type": "SoftwareApplication",
    "@id": `${site.url}/#software`,
    name: site.name,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Contractor estimating and proposal software",
    operatingSystem: "Web",
    description: opts.description ?? site.description,
    offers: softwareOffers(),
    url: opts.url ?? site.url,
    publisher: { "@id": ORG_ID() },
  };
}

export function organizationLd() {
  return {
    "@type": "Organization",
    "@id": ORG_ID(),
    name: site.name,
    url: site.url,
    logo: `${site.url}/icon.png`,
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: site.supportEmail, availableLanguage: "English" },
    // Official profiles Built2Bid controls. Add a profile here only once it is live and claimed.
    sameAs: ["https://www.linkedin.com/company/built2bid", "https://www.g2.com/products/built2bid/reviews"],
  };
}

/** BreadcrumbList from Home to the current page. `path` values start with "/". */
export function breadcrumbLd(trail: { name: string; path: string }[]) {
  const items = [{ name: "Home", path: "/" }, ...trail];
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: `${site.url}${t.path === "/" ? "" : t.path}` })),
  };
}

export function faqLd(faqs: readonly { q: string; a: string }[]) {
  return { "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
}

/** Serialises a graph for a <script type="application/ld+json"> tag ("<" escaped so text can't close the tag). */
export function ldJson(...nodes: object[]): string {
  const body = nodes.length === 1 ? { "@context": "https://schema.org", ...nodes[0] } : { "@context": "https://schema.org", "@graph": nodes };
  return JSON.stringify(body).replace(/</g, "\\u003c");
}
