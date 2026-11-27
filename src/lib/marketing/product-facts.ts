/**
 * Product facts (V11.0): the one plain-language description of what Built2Bid is, who it is for,
 * what it costs, what it connects to and what it does NOT do. It feeds /what-is-built2bid, its
 * JSON-LD and /llms.txt, so people, search engines and AI search tools all read the same facts.
 *
 * Rules (tests/product-facts.test.ts):
 * - Prices come from the billing modules (via PRICES / plans), never typed here.
 * - Features come from the marketing catalog and are listed only when live on this deploy.
 * - Limitations are stated plainly. Built-in payroll, paying subs/vendors, online invoice payments,
 *   live supplier price feeds and a native iPhone app are NOT available today.
 * - Nothing on the claims register's prohibited list (no stats, counts, ratings, awards, guarantees).
 * - Change VERIFIED_ON whenever a person re-checks this page against the live app.
 */
import { ENTERPRISE_SEAT_TIERS } from "@/lib/enterprise/pricing";
import { formatUsd } from "@/lib/billing/plans";
import { FREE_SAVED_ITEMS_LIMIT } from "@/lib/library/saved-items";
import { COMPANY } from "@/lib/marketing/about";
import { featureStatus, featuresFor, PILLARS, PM_PRODUCT_NAME, PRICES, pmMarketedLive, type Pillar } from "@/lib/marketing/catalog";
import { plans, site } from "@/lib/site";
import { trades } from "@/lib/trades/catalog";

/** Date a person last checked these facts against the live app and billing (YYYY-MM-DD). */
export const VERIFIED_ON = "2026-11-27";

export const FACTS_PATH = "/what-is-built2bid";

const tradeList = trades.filter((t) => !/custom/i.test(t.name));

export interface FactPlan { name: string; price: string; summary: string; points: string[] }

export function productFacts(env: Record<string, string | undefined> = process.env) {
  const pm = pmMarketedLive(env);
  const qb = env.NEXT_PUBLIC_QUICKBOOKS === "on";
  const live = (p: Pillar) => featuresFor(p).filter((f) => featureStatus(f, env) === "live");
  const seatTiers = ENTERPRISE_SEAT_TIERS.map((t, i) => {
    const next = ENTERPRISE_SEAT_TIERS[i + 1];
    return `users ${t.firstUser}${next ? `-${next.firstUser - 1}` : "+"}: ${formatUsd(t.unitCents)} each`;
  }).join(", ");

  const summary = `${site.name} is web-based estimating and proposal software for contractors. You build an estimate for your trade, price materials and labor with markup or margin, send a branded proposal your customer can sign online, and track every bid from draft to won.${pm ? ` With the ${PM_PRODUCT_NAME} add-on, a won bid becomes a job schedule with crew assignments, progress tracking and customer updates.` : ""}`;

  const audience = [
    "Owner-operators and small contracting companies, mostly 1 to 20 people.",
    "General contractors, remodelers and subcontractors.",
    `Specialty trades: ${tradeList.length} trade-specific estimate builders, plus a custom estimate for anything else.`,
    "Contractors moving off spreadsheets, Word templates or paper estimates.",
  ];

  const problems = [
    { title: "Estimates take too long and look homemade", body: "Start from sections made for your trade, use quantity calculators inside each line, and send a clean branded PDF." },
    { title: "Not sure you are making money on a job", body: "See cost, markup, margin and profit update as you price. Your costs and margins never appear on the customer's copy." },
    { title: "Bids get lost after you send them", body: "Every bid sits in a pipeline from Draft to Won, with signing links and status in one place." },
    ...(pm ? [{ title: "Won jobs live in your head or a whiteboard", body: `${PM_PRODUCT_NAME} turns the estimate's sections into a schedule, a company calendar and crew assignments.` }] : []),
  ];

  const workflows = (["win", "run", "grow"] as const)
    .map((p) => ({ pillar: p, title: PILLARS[p].title, lead: PILLARS[p].lead, features: live(p).map((f) => ({ name: f.name, description: f.description, tier: f.tier })) }))
    .filter((w) => w.features.length > 0);

  const planList: FactPlan[] = [
    {
      name: "Free",
      price: "$0",
      summary: `The full estimate builder and proposals, with ${plans.starterCredits} free bids to start and ${plans.monthlyCredits} free bid every month from the second month.`,
      points: [
        "No credit card to sign up.",
        "Build and preview drafts before creating an account.",
        "Finalizing a new bid uses one credit. Editing and re-downloading it does not.",
        `Up to ${FREE_SAVED_ITEMS_LIMIT} Saved Items.`,
      ],
    },
    {
      name: "Individual Unlimited",
      price: `${PRICES.unlimitedMonthly}/month or ${PRICES.unlimitedAnnual}/year`,
      summary: "Unlimited bids for one user, plus premium tools.",
      points: ["Unlimited finalized bids.", "Unlimited Saved Items, Proposal Templates and the private Internal Estimate Report."],
    },
    {
      name: "Team",
      price: `${PRICES.enterpriseBase}/month for ${PRICES.enterpriseIncludedUsers} users`,
      summary: "A company account where each licensed user has their own login and unlimited bidding.",
      points: [`Extra users per month: ${seatTiers}.`, "Roles and permissions, a company dashboard and team pipeline, shared customers and pricing, one proposal style and one bill."],
    },
  ];
  const addOns = pm
    ? [{ name: PM_PRODUCT_NAME, price: `${PRICES.pmMonthly}/month or ${PRICES.pmAnnual}/year on Individual Unlimited`, summary: `Scheduling from won bids, Gantt timeline, company calendar, crew and sub assignments, progress tracking and customer progress updates. Team includes ${PRICES.pmIncludedEnterpriseEditors} schedule editor; extra editors are ${PRICES.pmEditor}/month each.` }]
    : [];

  const free = [
    `${plans.starterCredits} free bids, then ${plans.monthlyCredits} free bid every month.`,
    "Free contractor calculators (concrete, deck boards, roofing, markup and margin) with no account.",
    "Free contractor guides on pricing and estimating.",
    "Contractor Academy: free courses, a building-code lookup that links to official sources, and a start-your-business guide by state.",
  ];

  const integrations = [
    { name: "E-signatures", status: "Built in. Customers sign proposals and change orders online; the signed PDF and audit trail are saved with the bid." },
    { name: "Email", status: "Send proposals from your own email address." },
    ...(qb ? [{ name: "QuickBooks Online", status: "Approved crew hours are sent to QuickBooks Online, where you run payroll. Invoices and payments are not synced." }] : []),
    { name: "Imports", status: "Bring in customers (including QuickBooks customer exports), employees, subcontractors and supplier price lists from CSV or Excel." },
    { name: "Optional AI drafting", status: "Describe a job and get suggested line items to review. Prices come from your own saved pricing first; anything else is labelled as a guess to verify." },
  ];

  const limitations = [
    "No built-in payroll. Hours can be exported or sent to QuickBooks Online and payroll runs there.",
    "Does not pay subcontractors, vendors or workers. Bills are recorded only.",
    "Your customers cannot pay invoices online through Built2Bid yet.",
    "No live supplier or retail price feeds. You enter your own costs or upload your supplier's price list.",
    "Not a replacement for an accountant or for full accounting software.",
    "No native iPhone app. It runs in any modern browser and can be installed on a phone's home screen.",
    "Built for US contractors: English, US dollars and US sales tax.",
  ];

  const company = {
    legalName: COMPANY.legalName,
    state: COMPANY.state,
    website: site.url,
    support: site.supportEmail,
    launched: "November 2026",
  };

  const faqs = [
    { q: `What is ${site.name}?`, a: summary },
    { q: `Who is ${site.name} for?`, a: `Small contracting businesses, from one-person shops to crews of about 20: general contractors, remodelers, subcontractors and specialty trades such as roofing, decks, concrete, painting, electrical, plumbing and HVAC. There are ${tradeList.length} trade-specific estimate builders plus a custom option.` },
    { q: `How much does ${site.name} cost?`, a: `Free to start with ${plans.starterCredits} free bids and ${plans.monthlyCredits} free bid a month. Individual Unlimited is ${PRICES.unlimitedMonthly}/month or ${PRICES.unlimitedAnnual}/year. Team is ${PRICES.enterpriseBase}/month for ${PRICES.enterpriseIncludedUsers} users.${pm ? ` ${PM_PRODUCT_NAME} scheduling is an add-on at ${PRICES.pmMonthly}/month.` : ""} No long-term contracts; paid periods are non-refundable.` },
    { q: "Do I need to sign up to try it?", a: "No. You can pick a trade, build an estimate and preview the proposal first. A free account is needed to download, email or save to the cloud." },
    { q: "Can customers sign proposals online?", a: "Yes. You send a secure signing link; the signed PDF and audit trail are saved with the bid, and the bid moves to Won." },
    { q: `Does ${site.name} run payroll?`, a: limitations[0] },
    { q: "Does it work on a phone?", a: "Yes. It runs in any modern browser on a phone, tablet or computer, and can be installed on a phone's home screen. There is no native iPhone app." },
    { q: "Will my customer see my costs or markup?", a: "No. Customer proposals are built only from customer prices. Costs, margins and internal notes stay private." },
  ];

  return { summary, audience, problems, workflows, plans: planList, addOns, free, integrations, limitations, company, faqs, trades: tradeList.map((t) => ({ name: t.name, slug: t.slug })), verifiedOn: VERIFIED_ON };
}

export type ProductFacts = ReturnType<typeof productFacts>;
