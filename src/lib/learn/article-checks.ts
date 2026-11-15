/**
 * Automated quality gate for generated pricing guides. The weekly writer
 * (scripts/content/write-article.ts) refuses to publish an article that fails any check, and
 * tests/learn-articles.test.ts runs the same checks over every published guide on each build.
 *
 * The rules keep guides honest: no invented market prices, statistics or dated claims; dollar
 * figures only inside clearly labelled worked examples whose arithmetic must add up.
 */
import type { Article, ArticleBlock } from "./articles";
import { CODE_CITATION, codeRefsFor } from "./code-references";

export interface CheckResult { ok: boolean; problems: string[] }

/** Phrases that signal invented data, sourcing we can't back up, or hype. */
const BANNED: { re: RegExp; why: string }[] = [
  { re: /\baverage\s+(?:cost|price|rate|wage|charge|bid)s?\b/i, why: "quotes an 'average cost/price' (we have no source for market averages)" },
  { re: /\bnational(?:ly)?\b(?! electrical code| fire protection)|\bnationwide\b/i, why: "makes a national/market-wide claim" },
  { re: /\baccording to\b|\bstud(?:y|ies)\b|\bsurvey(?:s|ed)?\b|\bresearch (?:shows|suggests|finds)\b|\bstatistic/i, why: "cites a study, survey or statistic" },
  { re: /\bin 20\d\d\b|\bthis year\b|\bcurrent(?:ly)? (?:prices?|rates?)\b/i, why: "makes a dated or current-price claim" },
  { re: /\btypically (?:costs?|runs?|charges?)\b|\bcosts? (?:about|around|roughly|between)\b/i, why: "states what work typically costs" },
  { re: /\$\s?\d[\d,.]*\s*(?:-|–|—|to)\s*\$\s?\d/i, why: "gives a dollar price range" },
  { re: /\bguarantee[sd]?\b|\bbest (?:software|app|tool)\b|\b#1\b|\bnumber one\b/i, why: "uses a guarantee or superlative claim" },
  { re: /\bas an ai\b|\blanguage model\b/i, why: "mentions AI authorship" },
];

const blockText = (b: ArticleBlock) => [b.h ?? "", ...(b.p ?? []), ...(b.list ?? [])].join("\n");
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Parse "1,200", "$95", "25%" into a number (percent as a fraction). */
function evalExpr(raw: string): number | null {
  const s = raw
    .replace(/\(([^()]*[A-Za-z][^()]*)\)/g, " ") // drop parentheticals with words: "(25% markup)"
    .replace(/(\d)\s*[x×*]\s*(?=[$\d(])/gi, "$1 × ")
    .replace(/[A-Za-z][A-Za-z.'’-]*/g, " ") // drop unit words: "12 squares" → "12"
    .replace(/[$,]/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .trim();
  if (!s || !/\d/.test(s) || !/^[\d\s.+\-*/()]+$/.test(s)) return null;
  // Two numbers side by side ("12 1140") means words separated values we can't read safely.
  if (/\d\s+[\d(]/.test(s.replace(/\s*([+\-*/])\s*/g, "$1"))) return null;
  try {
    // Only digits, dots, spaces, parentheses and + - * / reach this point (checked above).
    const v = Function(`"use strict"; return (${s});`)() as unknown;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Every "a = b = c" chain whose sides are plain arithmetic must agree to within half a percent. */
export function checkFormulaMath(line: string): string | null {
  const sides = line.replace(/^[^:]*:\s*/, (m) => (/\d/.test(m) ? m : "")).split("=");
  if (sides.length < 2) return null;
  const values = sides.map(evalExpr);
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i], b = values[i + 1];
    if (a === null || b === null) continue;
    const tol = Math.max(0.011, Math.abs(b) * 0.005);
    if (Math.abs(a - b) > tol) return `math does not add up in "${line}" (${round(a)} vs ${round(b)})`;
  }
  return null;
}
const round = (n: number) => Math.round(n * 100) / 100;

export interface CheckOptions {
  knownTrades?: Set<string>;
  existingSlugs?: Set<string>;
  /** URLs the research step actually found. Sources outside this set are rejected (writer only). */
  allowedSources?: Set<string>;
  /** Require a building-code quality tips section (writer only, for trades with code references). */
  requireCodeSection?: boolean;
}

/** A measurement in the same sentence as a code reference reads as a code requirement. */
const MEASURE = /\d+(?:\.\d+)?\s*(?:-\s*)?(?:inch(?:es)?|in\.|feet|foot|ft\b|psf|psi|pounds|lbs?\b|mph|percent|%|"|″|′)/i;
const CODE_WORDS = /\b[RNMPE]\d{3,4}\b|\bIRC\b|\bcodes?\b|\bInternational Residential Code\b/i;

export function checkArticle(a: Article, opts: CheckOptions = {}): CheckResult {
  const problems: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug) || a.slug.length > 80) problems.push("slug must be lowercase words joined by hyphens");
  if (opts.existingSlugs?.has(a.slug)) problems.push(`slug ${a.slug} is already published`);
  if (a.title.length < 20 || a.title.length > 75) problems.push(`title should be 20–75 characters (is ${a.title.length})`);
  if (a.description.length < 90 || a.description.length > 170) problems.push(`description should be 90–170 characters (is ${a.description.length})`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.updated)) problems.push("updated must be YYYY-MM-DD");
  if (a.trade && opts.knownTrades && !opts.knownTrades.has(a.trade)) problems.push(`unknown trade ${a.trade}`);
  if (a.blocks.length < 6 || a.blocks.length > 14) problems.push(`needs 6–14 sections (has ${a.blocks.length})`);
  const headings = a.blocks.filter((b) => b.h).length;
  if (headings < 5) problems.push("needs at least 5 headed sections");

  const prose = [a.title, a.description, ...a.blocks.map(blockText)].join("\n");
  const words = wordCount(prose) + wordCount(a.blocks.flatMap((b) => b.formula ?? []).join(" "));
  if (words < 650 || words > 1700) problems.push(`length should be 650–1700 words (is ${words})`);
  for (const { re, why } of BANNED) {
    const all = [prose, ...a.blocks.flatMap((b) => b.formula ?? [])].join("\n");
    const m = all.match(re);
    if (m) problems.push(`${why}: "${m[0]}"`);
  }
  // Dollar figures belong only in worked examples (formula blocks), never in prose as "the price".
  if (/\$\s?\d/.test(prose)) problems.push("dollar amounts may appear only inside worked-example formula blocks");

  const formulas = a.blocks.flatMap((b) => b.formula ?? []);
  if (formulas.length < 2) problems.push("needs at least one worked example (formula block)");
  const exampleBlocks = a.blocks.filter((b) => b.formula?.some((f) => /\$\s?\d/.test(f)));
  for (const b of exampleBlocks) {
    const labelled = [b.h ?? "", ...(b.p ?? []), ...(b.formula ?? [])].join(" ");
    if (!/\bexample\b/i.test(labelled)) problems.push(`worked example "${b.h ?? b.formula?.[0]}" must be labelled as an example`);
  }
  for (const f of formulas) {
    const err = checkFormulaMath(f);
    if (err) problems.push(err);
  }
  if (!/\b(?:local|your (?:own|supplier|recent)|supplier quotes?)\b/i.test(prose)) problems.push("must tell readers to use their own or local costs");

  // Building code references: only vetted IRC sections for this trade, named not paraphrased.
  const allowed = new Set(codeRefsFor(a.trade).map((r) => r.code));
  const cited = [...new Set(prose.match(CODE_CITATION) ?? [])];
  for (const c of cited) if (!allowed.has(c)) problems.push(`cites code section ${c}, which is not in the vetted list for this trade`);
  for (const sentence of prose.split(/(?<=[.!?])\s+|\n/)) {
    if (CODE_WORDS.test(sentence) && MEASURE.test(sentence)) problems.push(`states a measurement next to a code reference (editions and local amendments vary): "${sentence.slice(0, 120)}"`);
  }
  if (cited.length && !/\bbuilding department\b/i.test(prose)) problems.push("cites the building code without telling readers to confirm with their local building department");
  if (opts.requireCodeSection) {
    if (!cited.length) problems.push("needs a quality tips section that names the relevant IRC sections");
    if (!a.blocks.some((b) => b.h && /\b(?:quality|code|inspection)s?\b/i.test(b.h))) problems.push("needs a headed quality tips / code section");
  }

  // Further reading: real pages the research step found, at most five, https only.
  const sources = a.sources ?? [];
  if (sources.length > 5) problems.push("at most 5 sources");
  for (const src of sources) {
    if (!/^https:\/\/[^\s]+$/.test(src.url)) problems.push(`source URL must be https: ${src.url}`);
    if (!src.title.trim()) problems.push(`source needs a title: ${src.url}`);
    else if (/^https:/.test(src.url) && !usableSource(src.url, src.title)) problems.push(`source is a cost guide or lead-generation page: ${src.url}`);
    if (opts.allowedSources && !opts.allowedSources.has(src.url)) problems.push(`source was not found by the research step: ${src.url}`);
  }
  if (new Set(sources.map((x) => x.url)).size !== sources.length) problems.push("duplicate source URLs");
  return { ok: problems.length === 0, problems };
}

/**
 * Pages we never link as further reading: homeowner cost guides and lead-generation marketplaces
 * (they quote the market prices our guides deliberately avoid, and several compete for the same
 * contractors), plus anything whose title advertises prices.
 */
const BLOCKED_SOURCE_HOSTS = /(?:^|\.)(?:angi|angieslist|homeadvisor|thumbtack|homeguide|fixr|porch|modernize|houzz|yelp|bark|networx|homeyou|costhelper|costowl|improvenet|forbes|bankrate|nerdwallet|insuranceopedia|lendingtree|reddit|quora|youtube|facebook|pinterest|tiktok|instagram)\.com$/i;
const BLOCKED_SOURCE_TITLE = /\$|\bhow much\b|\bcheapest\b|\bcost (?:guide|calculator|data)\b|\bdata\]|\bquotes? near\b/i;
export function usableSource(url: string, title: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !BLOCKED_SOURCE_HOSTS.test(u.hostname.replace(/^www\./, "")) && !BLOCKED_SOURCE_TITLE.test(title);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ topic plan */

export interface Topic { slug: string; trade?: string; title: string; angle: string }
interface TradeLite { slug: string; name: string; featured?: boolean }

const GENERAL: Topic[] = [
  { slug: "how-to-calculate-your-labor-rate", title: "How to Calculate Your Labor Rate as a Contractor", angle: "Build a billable hourly labor rate from wage, labor burden (payroll taxes, insurance, benefits) and non-billable time, with a worked example. Explain why the rate you pay is not the rate you charge." },
  { slug: "how-to-build-overhead-into-your-bids", title: "How to Build Overhead Into Your Bids", angle: "Identify overhead costs, estimate annual overhead, and recover it either as a percentage of direct cost or per labor hour. Worked example. Warn about double counting with markup." },
  { slug: "how-to-price-change-orders", title: "How to Price Change Orders Without Losing Money", angle: "Price added work, credits for removed work, schedule impact and admin time; get written approval before work starts; how to show it on paperwork." },
  { slug: "how-much-contingency-to-include", title: "How Much Contingency to Include in an Estimate", angle: "What contingency is for, how to decide on it from job risk and unknowns, line item vs built into markup, and how to explain it to customers. No industry percentages presented as facts; examples only." },
  { slug: "pricing-small-jobs-minimum-charges", title: "Pricing Small Jobs: Minimum Charges and Trip Fees", angle: "Why small jobs lose money (travel, setup, cleanup, admin), how to set a minimum job charge from your own costs, with a worked example." },
  { slug: "waste-factors-in-material-takeoffs", title: "Waste Factors in Material Takeoffs, Explained", angle: "What a waste factor is, why it differs by material, layout and crew, how to apply it to takeoff quantities and round to purchasable units, worked example. Tell readers to set factors from their own past jobs." },
  { slug: "deposits-and-payment-schedules", title: "Deposits and Payment Schedules for Contractors", angle: "Structuring deposits and milestone payments tied to completed work; why to check state rules on deposit limits; how to present the schedule in a proposal. No legal advice; point to an attorney or state licensing board." },
  { slug: "unit-pricing-vs-lump-sum-bids", title: "Unit Pricing vs. Lump Sum Bids: When to Use Each", angle: "Define unit price and lump sum bids, pros and cons for contractor and customer, how to build unit prices from cost plus markup, worked example." },
  { slug: "how-to-price-equipment-rental-in-a-bid", title: "How to Price Equipment Rental and Ownership Costs in a Bid", angle: "Rental items as pass-through or marked-up costs, delivery and fuel, charging for owned equipment with an hourly or daily recovery rate built from your own costs, worked example." },
  { slug: "how-to-price-subcontractor-work", title: "How to Price Subcontractor Work in Your Estimate", angle: "Collect comparable sub quotes, check scope gaps, decide on markup for managing subs, and show it to the customer. Worked example." },
  { slug: "how-to-raise-your-prices", title: "How to Raise Your Prices Without Losing Good Customers", angle: "Know your real costs first, review job profitability, communicate changes, update price validity dates on proposals. Practical, no statistics." },
  { slug: "how-long-should-a-bid-be-valid", title: "How Long Should a Contractor Bid Be Valid?", angle: "Why proposals need an expiration date, factors that shorten it (material price volatility, schedule), wording for price validity and re-pricing. No specific market claims." },
];

/** The publishing order: featured trades first, a general topic every third slot, then the rest. */
export function topicPlan(trades: TradeLite[]): Topic[] {
  const howTo = (t: TradeLite): Topic => ({
    slug: `how-to-price-${t.slug}-jobs`,
    trade: t.slug,
    title: `How to Price ${t.name} Jobs: A Step-by-Step Method`,
    angle: `A practical method for pricing ${t.name.toLowerCase()} work: measuring and quantity takeoff in the right units, materials with waste, labor hours and labor rate, equipment and disposal, permits, overhead, then markup or margin. Include one worked example with clearly labelled example numbers.`,
  });
  const checklist = (t: TradeLite): Topic => ({
    slug: `${t.slug}-estimate-checklist`,
    trade: t.slug,
    title: `${t.name} Estimate Checklist: Items Contractors Often Miss`,
    angle: `A checklist of the line items, site conditions, exclusions and allowances to cover in a ${t.name.toLowerCase()} estimate so nothing is left out, organised by estimate section. Include one short worked example showing how a missed item affects profit, with clearly labelled example numbers.`,
  });
  const usable = trades.filter((t) => t.slug !== "other");
  const ordered = [...usable.filter((t) => t.featured), ...usable.filter((t) => !t.featured)];
  const tradeTopics = [...ordered.map(howTo), ...ordered.map(checklist)];
  const plan: Topic[] = [];
  let g = 0;
  tradeTopics.forEach((t, i) => {
    plan.push(t);
    if (i % 2 === 1 && g < GENERAL.length) plan.push(GENERAL[g++]);
  });
  while (g < GENERAL.length) plan.push(GENERAL[g++]);
  return plan;
}

export function nextTopic(trades: TradeLite[], published: Set<string>): Topic | undefined {
  return topicPlan(trades).find((t) => !published.has(t.slug));
}
