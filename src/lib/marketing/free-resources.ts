/**
 * Free resources (/free): one per Built2Bid YouTube episode (growth-os video plan, v2).
 * Each one extends the lesson of its episode. No account, no email capture: nothing a visitor
 * types leaves the page. Every dollar figure here is a fictional example and says so on the page.
 */

export type ResourceKind = "checklist" | "table" | "template" | "calculator";
export type CalculatorId = "pricing-worksheet" | "cost-per-hour" | "bid-vs-actual" | "setup-sheet";

export interface FreeResource {
  slug: string;
  episode: number;
  /** Card name and H1. */
  name: string;
  /** <title> */
  title: string;
  description: string;
  kind: ResourceKind;
  intro: string;
  /** Checklist items or template sections: a heading plus what to write under it. */
  items?: { heading: string; text: string }[];
  calculator?: CalculatorId;
  /** Related free calculator or guide on the site. */
  related?: { href: string; label: string }[];
}

/** Price that leaves `marginPct` of the price after cost. 15% margin: cost ÷ 0.85. */
export function priceForMargin(cost: number, marginPct: number): number {
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(marginPct) || marginPct < 0 || marginPct >= 100) return NaN;
  return cost / (1 - marginPct / 100);
}

/** Margin (share of the price) that a markup (share of the cost) gives. 30% markup → 23.08%. */
export function marginFromMarkup(markupPct: number): number {
  if (!Number.isFinite(markupPct) || markupPct < 0) return NaN;
  return (markupPct / (100 + markupPct)) * 100;
}

/** Overhead per billable hour: yearly overhead ÷ (working weeks × billable hours a week). */
export function overheadPerHour(yearlyOverhead: number, weeks: number, billableHoursPerWeek: number): number {
  const hours = weeks * billableHoursPerWeek;
  if (!Number.isFinite(yearlyOverhead) || yearlyOverhead < 0 || !(hours > 0)) return NaN;
  return yearlyOverhead / hours;
}

export function roundUpTo(n: number, step: number): number {
  return Math.ceil(n / step) * step;
}

export const MARKUP_ROWS = [10, 15, 20, 25, 30, 35, 40, 50, 60, 75, 100];

export const FREE_RESOURCES: FreeResource[] = [
  {
    slug: "estimate-leak-checklist",
    episode: 1,
    name: "5-Leak Estimate Checklist",
    title: "Free Estimate Checklist: 5 Leaks to Check Before You Send a Price",
    description: "A free one-page checklist of the five estimating mistakes to check on every bid before the price goes out.",
    kind: "checklist",
    intro: "Run these five checks on every estimate before it goes to the customer. Print it, or keep it open next to your estimate.",
    items: [
      { heading: "Markup or margin?", text: "Know which one you used. A 25% markup is a 20% margin, not 25%. Check the margin table if you're not sure." },
      { heading: "Waste on every material line", text: "Tile, trim, drywall, lumber and paint each get a waste or overage line. No waste line means you buy it at your cost." },
      { heading: "Labor hours from a real job", text: "Compare the hours with the last job like this one, not with your best day. Add the setup, cleanup and drive time." },
      { heading: "Overhead in the price", text: "Insurance, truck, phone, software and office time are part of every job. Use your cost per hour so each job carries its share." },
      { heading: "A line for the unknowns", text: "Name what you can't see yet (behind walls, under floors) and say in writing how it will be handled: an allowance, a contingency or a change order." },
    ],
    related: [{ href: "/free/markup-to-margin-table", label: "Markup-to-margin table" }, { href: "/free/cost-per-hour-calculator", label: "Cost-per-hour calculator" }],
  },
  {
    slug: "job-pricing-worksheet",
    episode: 2,
    name: "Job Pricing Worksheet",
    title: "Free Job Pricing Worksheet for Contractors (Step by Step)",
    description: "Price a construction job line by line: materials, labor, overhead, then the margin. Free, no account needed.",
    kind: "calculator",
    calculator: "pricing-worksheet",
    intro: "The same steps as the video: materials with waste, labor at a burdened rate, the job's share of overhead, then the price for the margin you want. The example numbers are a deck rebuild; type over them with your own.",
    related: [{ href: "/free/cost-per-hour-calculator", label: "Work out your overhead per hour" }],
  },
  {
    slug: "markup-to-margin-table",
    episode: 3,
    name: "Markup-to-Margin Table",
    title: "Markup to Margin Table for Contractors (Free, Printable)",
    description: "See what margin each markup really gives you, from 10% to 100%. Free and printable.",
    kind: "table",
    intro: "Markup is a share of your cost. Margin is a share of the price. They're never the same number. Find your markup in the left column to see the margin it gives.",
    related: [{ href: "/tools", label: "Markup and margin calculator" }],
  },
  {
    slug: "price-conversation-card",
    episode: 4,
    name: "Price Conversation Card",
    title: "What to Say When a Customer Says Your Price Is Too High (Free Card)",
    description: "A free one-page card with three steps for the 'your price is too high' conversation, without cutting your price first.",
    kind: "checklist",
    intro: "Three steps for the moment a customer says the price is too high. Keep it in the truck.",
    items: [
      { heading: "1. Don't cut the price first", text: "A discount comes straight out of what's left after cost. On a job priced at a 15% margin, 10% off leaves you about a third of the profit you planned." },
      { heading: "2. Ask which part feels high", text: "\"Which part of the price feels high to you?\" Then listen. The gap is usually one or two items, not the whole job." },
      { heading: "3. Change the scope, not the price", text: "Offer options that lower the cost of the job: a different material, a smaller area, a phase done later. Write down what changed." },
      { heading: "Words that help", text: "\"I want this to fit your budget. Let's look at what we can change in the job so the price comes down without cutting corners.\"" },
    ],
  },
  {
    slug: "customer-view-template",
    episode: 5,
    name: "Customer-View Estimate Template",
    title: "Estimate Template: Show the Customer Sections, Not Line Items (Free)",
    description: "A free estimate layout that shows the customer clear sections plus the four headings that prevent most arguments.",
    kind: "template",
    intro: "Show the customer the job in sections, with a price for each, and four headings at the bottom. Keep your line items, quantities and costs on your side.",
    items: [
      { heading: "Sections with a price each", text: "For example: Demo · Plumbing and electrical · Tile and finishes · Fixtures · Cleanup and contingency. Five to eight sections for most remodels." },
      { heading: "Included", text: "Write out what the price covers, in plain words the customer can check against the finished job." },
      { heading: "Not included", text: "Name what isn't in the price: permits if the owner pulls them, painting, hauling, repairs to hidden damage." },
      { heading: "Allowances", text: "Give a dollar amount for items the customer picks later (tile, fixtures). Say in writing that a choice above the allowance is billed as a change." },
      { heading: "Change orders", text: "Say how changes are priced and approved: in writing, signed, before the work is done." },
    ],
  },
  {
    slug: "payment-schedule-template",
    episode: 6,
    name: "Payment Schedule Template",
    title: "Contractor Payment Schedule Template (Deposit and Draws, Free)",
    description: "A free payment schedule layout: deposit, milestone draws and final payment, so cash comes in as the work goes out.",
    kind: "template",
    intro: "Match the money coming in to the money going out. Check your state's rules on deposits before you use any percentage.",
    items: [
      { heading: "Deposit", text: "Enough to cover the materials you order before work starts, within your state's limit." },
      { heading: "Draw at each milestone", text: "Tie each payment to something the customer can see: demo done, rough-in passed, cabinets set. Write the amount, not just a percentage." },
      { heading: "Final payment", text: "Due on completion of the punch list, with the list attached. Keep it small enough that a dispute doesn't stop your cash." },
      { heading: "Change orders", text: "Billed when signed, or added to the next draw. Say which one in the contract." },
      { heading: "Owner pay line", text: "Not part of the schedule, but plan it: set your own pay as a cost on every job so it isn't just what's left over." },
    ],
  },
  {
    slug: "office-prompts-for-contractors",
    episode: 7,
    name: "10 Office Prompts for Contractors",
    title: "10 AI Prompts for Contractor Office Work (and What Not to Ask)",
    description: "Ten free AI prompts for contractor office work: emails, scopes and notes. Plus the questions AI gets wrong.",
    kind: "checklist",
    intro: "Paste these into any AI chat tool and fill in the brackets. Always read the answer before it goes to a customer. Never paste a customer's personal details.",
    items: [
      { heading: "1. Reword a customer email", text: "\"Rewrite this email to a homeowner so it's clear, polite and short: [paste].\"" },
      { heading: "2. Notes to scope", text: "\"Turn these site-visit notes into a scope of work with headings: [notes].\"" },
      { heading: "3. Included / not included", text: "\"List what is usually included and not included in a [job type], so I can check my scope.\"" },
      { heading: "4. Change order wording", text: "\"Write a short change order description for: [change]. Plain words, no price.\"" },
      { heading: "5. Delay update", text: "\"Write a short, honest update to a customer about a [number]-day delay caused by [reason].\"" },
      { heading: "6. Follow-up on a sent bid", text: "\"Write a friendly follow-up for a bid I sent [days] days ago. No pressure.\"" },
      { heading: "7. Job summary", text: "\"Summarize these job notes into 5 bullet points for my crew: [notes].\"" },
      { heading: "8. Question list for a walkthrough", text: "\"What should I ask a homeowner during a walkthrough for a [job type]?\"" },
      { heading: "9. Review reply", text: "\"Write a short, thankful reply to this customer review: [review].\"" },
      { heading: "10. Plain-language explainer", text: "\"Explain [technical item] to a homeowner in two sentences.\"" },
      { heading: "Don't ask AI for", text: "Prices (it makes them up), code or permit answers (check with your building department), or anything legal. Use your own numbers and local rules." },
    ],
  },
  {
    slug: "cost-per-hour-calculator",
    episode: 8,
    name: "Cost-Per-Hour Calculator",
    title: "What Does Your Business Cost Per Hour? Free Contractor Calculator",
    description: "Add up your yearly overhead and billable hours to see what your business costs per hour before you pick up a tool.",
    kind: "calculator",
    calculator: "cost-per-hour",
    intro: "Add up what the business costs in a year, divide by the hours you actually bill, and you have the overhead every hour of work has to carry. The example numbers are fictional; type over them.",
    related: [{ href: "/free/job-pricing-worksheet", label: "Put it into a price" }],
  },
  {
    slug: "bid-vs-actual-tracker",
    episode: 9,
    name: "Bid-vs-Actual Tracker",
    title: "Bid vs Actual Job Cost Tracker for Contractors (Free)",
    description: "Track a job's bid against what it really cost, line by line, including change orders and the work you did for free.",
    kind: "calculator",
    calculator: "bid-vs-actual",
    intro: "Write the bid, then add every surprise as it happens: billed change orders, costs you absorbed and extras you gave away. The total shows what the job really left after cost. The example numbers are fictional.",
  },
  {
    slug: "new-contractor-setup-sheet",
    episode: 10,
    name: "5-Number Setup Sheet",
    title: "Starting a Contracting Business? The 5-Number Setup Sheet (Free)",
    description: "Five numbers to set up before your first bid: overhead, billable hours, owner pay, cost per hour and your hourly price.",
    kind: "calculator",
    calculator: "setup-sheet",
    intro: "Work out these five numbers before your first bid. The example numbers are fictional; type over them with yours. Owner pay here is the salary you plan to pay yourself, not a promise of what the business will earn.",
  },
];

export function resourceBySlug(slug: string): FreeResource | undefined {
  return FREE_RESOURCES.find((r) => r.slug === slug);
}
