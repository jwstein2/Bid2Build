/**
 * Comparison pages (V11.0): Built2Bid vs a named competitor, written by people from the competitor's own
 * public pages. Rules (tests/comparisons.test.ts, docs/seo/AI_SEARCH.md):
 * - Competitor facts only from their own pages, linked in `sources`, with `verifiedOn`. Re-check quarterly
 *   or when they change pricing; promotions are left out (list prices only).
 * - Built2Bid facts come from product-facts / billing (never typed prices).
 * - Every page says honestly when the other product is the better fit. No rankings, "best", "#1",
 *   ratings, or claims about the competitor we can't link to.
 * - Original wording: never copy the competitor's marketing copy.
 */
import { PM_PRODUCT_NAME, PRICES, pmMarketedLive } from "@/lib/marketing/catalog";
import { plans } from "@/lib/site";
import { trades } from "@/lib/trades/catalog";

const TRADE_COUNT = trades.filter((t) => !/custom/i.test(t.name)).length;

export interface ComparisonRow { topic: string; built2bid: string; them: string }
export interface Comparison {
  slug: string;
  name: string;
  /** One-sentence, neutral description of the competitor. */
  them: string;
  verifiedOn: string;
  sources: { label: string; url: string }[];
  summary: string;
  rows: ComparisonRow[];
  chooseThem: string[];
  chooseUs: string[];
}

const B2B_PRICE = `Free (${plans.starterCredits} bids, then ${plans.monthlyCredits} a month). Individual Unlimited ${PRICES.unlimitedMonthly}/month or ${PRICES.unlimitedAnnual}/year. Team ${PRICES.enterpriseBase}/month for ${PRICES.enterpriseIncludedUsers} users.`;
const B2B_SCHEDULING = pmMarketedLive()
  ? `${PM_PRODUCT_NAME} add-on (${PRICES.pmMonthly}/month): schedule built from the won estimate, Gantt timeline, company calendar, crew and sub assignments.`
  : "Not offered.";

export const COMPARISONS: readonly Comparison[] = [
  {
    slug: "joist",
    name: "Joist",
    them: "Joist is an estimating, invoicing and payments app for contractors, used on phone and web.",
    verifiedOn: "2026-11-27",
    sources: [{ label: "Joist pricing and plan comparison", url: "https://www.joist.com/pricing/" }],
    summary: "Both build contractor estimates. Joist leans toward getting paid: invoices, online payments, Tap to Pay, homeowner financing. Built2Bid leans toward building the estimate itself: trade-specific sections, quantity calculators, markup or margin with live profit, and a free plan.",
    rows: [
      { topic: "Price (as listed)", built2bid: B2B_PRICE, them: "Basics $10/month (5 documents a month), Pro $17, Elite $32, Run $100, billed monthly; annual plans get 2 months free. 14-day free trial." },
      { topic: "Free plan", built2bid: "Yes, with no credit card.", them: "Free trial, then a paid plan." },
      { topic: "Estimate building", built2bid: `${TRADE_COUNT} trade-specific estimate builders with ready sections, quantity calculators in each line, materials, labor and sub lines, markup or target margin with live profit.`, them: "Line-item estimates, project templates and AI help writing estimates." },
      { topic: "Change orders", built2bid: "Signable change orders on approved bids, with a running contract total. Included free.", them: "Elite plan and up." },
      { topic: "Customer signatures", built2bid: "Secure signing link; signed PDF and audit trail saved with the bid. Included free.", them: "In-app digital signatures." },
      { topic: "Invoices and online payments", built2bid: "Your customers can't pay invoices online through Built2Bid yet.", them: "Invoices, online card payments, Tap to Pay, deposits and milestone payments." },
      { topic: "Scheduling", built2bid: B2B_SCHEDULING, them: "Job organization and visit scheduling on the Run plan." },
      { topic: "Homeowner financing", built2bid: "Not offered.", them: "Offered." },
      { topic: "QuickBooks", built2bid: "Approved crew hours sync to QuickBooks Online.", them: "QuickBooks sync." },
      { topic: "Private cost view", built2bid: "Costs, markup and margin never show on the customer copy; private Internal Estimate Report on Unlimited.", them: "Business and sales reports on Elite and up." },
    ],
    chooseThem: ["You mainly want to send quick estimates and invoices from your phone and collect card payments on the spot.", "You want homeowner financing offered with your quotes.", "You send only a handful of simple quotes a month."],
    chooseUs: ["You want help building the estimate itself for your trade, with calculators and live markup, margin and profit.", "You want a free plan before you pay anything.", "You want signable change orders and e-signatures without moving to a higher tier."],
  },
  {
    slug: "jobber",
    name: "Jobber",
    them: "Jobber is field service management software for home service businesses: quoting, scheduling, dispatch, invoicing and payments.",
    verifiedOn: "2026-11-27",
    sources: [{ label: "Jobber pricing (1 user)", url: "https://www.getjobber.com/pricing/" }],
    summary: "Jobber is built around running recurring service visits: booking, scheduling, reminders, invoicing and payments. Built2Bid is built around the estimate and proposal for project work, priced low, with scheduling as an add-on once a bid is won.",
    rows: [
      { topic: "Price (as listed, 1 user)", built2bid: B2B_PRICE, them: "Core $29/month, Connect $99/month, Grow $149/month billed annually ($49, $139 and $199 billed monthly). Add-ons such as Sales Pipeline and AI Receptionist cost extra. Free trial." },
      { topic: "Free plan", built2bid: "Yes, with no credit card.", them: "Free trial, then a paid plan." },
      { topic: "Best fit", built2bid: "Project work quoted from an estimate: remodels, decks, roofing, concrete and 30+ more trades.", them: "Service visits and repeat work. Its industry list centers on service trades (cleaning, lawn care, HVAC, pest control) and also includes construction." },
      { topic: "Estimate building", built2bid: "Trade-specific sections, quantity calculators, materials, labor and sub lines, markup or target margin with live profit.", them: "Quotes from line items; optional line items and visual quotes on Grow." },
      { topic: "Job costing", built2bid: "Live cost, markup, margin and profit while you price; private Internal Estimate Report on Unlimited.", them: "Job costing on the Grow plan." },
      { topic: "Scheduling and dispatch", built2bid: B2B_SCHEDULING, them: "Online booking and job scheduling on every plan; automated client reminders on Connect and up." },
      { topic: "Invoices and online payments", built2bid: "Your customers can't pay invoices online through Built2Bid yet.", them: "Invoicing and online payments on every plan." },
      { topic: "Customer texting", built2bid: "Not offered.", them: "Two-way SMS on Grow." },
      { topic: "QuickBooks", built2bid: "Approved crew hours sync to QuickBooks Online.", them: "QuickBooks Online sync on Connect and up." },
    ],
    chooseThem: ["Most of your work is recurring service visits that need booking, routing and reminders.", "You want customers to pay invoices online today.", "You want two-way texting with customers built in."],
    chooseUs: ["Your work is quoted project by project and the estimate is where you win or lose money.", "You want a free plan, or one paid plan for unlimited bids at a lower price.", "You want signable proposals and change orders without add-ons."],
  },
  {
    slug: "contractor-foreman",
    name: "Contractor Foreman",
    them: "Contractor Foreman is all-in-one construction management software covering projects, estimates, scheduling, financials, time cards and documents.",
    verifiedOn: "2026-11-27",
    sources: [{ label: "Contractor Foreman pricing and feature comparison", url: "https://contractorforeman.com/pricing/" }],
    summary: "Contractor Foreman covers a lot of construction management in one app: daily logs, punch lists, submittals, time cards, purchase orders and more. Built2Bid does fewer things, focused on estimating, proposals and signatures, with scheduling as an add-on, and has a free plan.",
    rows: [
      { topic: "Price (as listed, billed annually)", built2bid: B2B_PRICE, them: "Basic $49/month (1 user), Standard $105 (up to 3 users), Plus $166 (up to 8), Pro $221 (up to 15), Unlimited $332 (unlimited users). 30-day free trial." },
      { topic: "Free plan", built2bid: "Yes, with no credit card.", them: "Free trial, then a paid plan." },
      { topic: "Estimating", built2bid: `${TRADE_COUNT} trade-specific estimate builders, quantity calculators, markup or target margin with live profit, branded proposals.`, them: "Estimates, takeoffs, an AI estimator and a cost database." },
      { topic: "Change orders and signatures", built2bid: "Signable change orders and e-signatures included free.", them: "Change orders, sub-contracts and bid management." },
      { topic: "Project management", built2bid: B2B_SCHEDULING, them: "Projects, scheduling, daily logs, punch lists, work orders, permits, inspections, submittals, client portal." },
      { topic: "Time and crew", built2bid: "Crew time entries and approvals; approved hours sync to QuickBooks Online for payroll there. No built-in payroll.", them: "Time cards and crew schedules; Gusto payroll integration listed." },
      { topic: "Financials", built2bid: "Your customers can't pay invoices online through Built2Bid yet.", them: "Invoices, online payments, purchase orders; QuickBooks and Xero integrations listed." },
      { topic: "Learning curve", built2bid: "Fewer screens: estimate, proposal, pipeline, then schedule.", them: "Many modules; implementation help and training sessions are offered." },
    ],
    chooseThem: ["You want one system for the whole job: daily logs, punch lists, submittals, purchase orders and time cards.", "You need online payments, Xero or a payroll integration today.", "You have a larger crew and want training and implementation help."],
    chooseUs: ["You mainly need fast, professional estimates and proposals for your trade.", "You want to start free and pay little as one user.", "You'd rather learn a few screens than a full construction management suite."],
  },
];

export const getComparison = (slug: string) => COMPARISONS.find((c) => c.slug === slug);
