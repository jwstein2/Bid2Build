import { createHash } from "node:crypto";
import { plans } from "@/lib/site";
import { tradeName } from "@/lib/trades/catalog";
import { unsupportedClaims } from "./capabilities";
import type { Classification } from "./classify";
import { displayDomain, trackedUrl } from "./utm";

/**
 * Reply drafting for Opportunity Radar (deterministic rules engine + shared guards). The optional AI
 * writer (draft-ai.ts) produces text that goes through the same guards. Drafts are ALWAYS reviewed and
 * approved by the owner before anything is posted, and are posted by the owner as themself.
 */

export interface DraftContext {
  /** Stable seed (opportunity id) so phrasing varies across discussions but is repeatable for one. */
  seed: string;
  sourceKey: string;
  title: string;
  text: string;
  classification: Classification;
  linksAllowed: boolean;
  /** Owner override to allow a product mention on a priority D thread. */
  allowProductMention?: boolean;
}

export interface DraftResult {
  body: string;
  mentionsProduct: boolean;
  includesLink: boolean;
  flags: DraftFlag[];
  needsManualReview: boolean;
  reviewReason?: string;
}

export type DraftFlag =
  | { kind: "unsupported_claim"; claim: string }
  | { kind: "missing_disclosure" }
  | { kind: "link_not_allowed" }
  | { kind: "too_similar"; similarity: number }
  | { kind: "repeats_link" }
  | { kind: "needs_verification"; reason: string }
  | { kind: "injection_suspected" }
  | { kind: "placeholder" };

const pick = <T,>(seed: string, salt: string, arr: readonly T[]): T => {
  const h = createHash("sha256").update(`${seed}:${salt}`).digest();
  return arr[h.readUInt32BE(0) % arr.length];
};

// ---------------------------------------------------------------------------------------------
// Helpful content by topic (the advice comes first; the product is optional)
// ---------------------------------------------------------------------------------------------
const ADVICE: Record<string, readonly string[]> = {
  "Estimating software": [
    "Whatever you pick, I'd check three things: can it use your own labor and material costs, does it handle markup vs margin the way you price, and can you show the customer a clean total without exposing your line-item costs.",
    "Honestly the best tool is the one you'll actually use on a Tuesday night. I'd look for something that starts from your own costs, lets you price with markup or margin, and spits out a proposal you're not embarrassed to send.",
  ],
  Spreadsheets: [
    "Spreadsheets are fine until you're re-copying the same formulas every job. What helped me most was keeping a saved list of my usual materials and labor so each bid starts mostly filled in.",
    "Nothing wrong with a spreadsheet if it's working. The pain usually shows up in retyping the same items and making the final version look presentable to the customer.",
  ],
  "Markup vs margin": [
    "Quick way to keep them straight: markup is a percent of your cost, margin is a percent of the selling price. $1,000 of cost with a 25% markup sells for $1,250, which is only a 20% margin. If you want a true 25% margin, divide cost by 0.75, so $1,333.",
    "Markup is calculated on cost and margin on price, so the same percentage gives you different numbers. Example: $1,000 cost at 25% markup is $1,250, but to make a 25% margin you'd need to charge about $1,333.",
  ],
  "Labor estimating": [
    "For labor I'd estimate hours per task, multiply by a loaded rate (wage plus taxes, insurance and the time nobody bills for), and keep a note of actual hours on finished jobs so the next estimate gets better.",
  ],
  "Material estimating": [
    "For materials, build the list by section (prep, install, trim, cleanup and so on), add a waste factor you can defend, and keep your last supplier prices handy so you're not looking everything up again.",
  ],
  "Professional proposals": [
    "What made the biggest difference for us was a clear scope written in plain English, a short exclusions list, and showing grouped sections or one total instead of every single line item.",
    "Customers mostly want to see what's included, what isn't, and one clear price. A logo, a written scope and an exclusions section go a long way.",
  ],
  "Scope of work": [
    "For the scope, I'd list what you're doing by area or phase, name the materials if they matter to the customer, and leave out anything you're not 100% sure about rather than guessing.",
  ],
  Exclusions: [
    "Common ones worth listing: permits unless noted, hidden damage found during demo, moving furniture or contents, utility locates, and changes requested after signing billed as change orders.",
  ],
  "Time spent quoting": [
    "Most of the time I lost on estimates was retyping the same items and fiddling with formatting. Templates for your most common jobs and a saved list of materials cut that down a lot.",
  ],
  "Winning bids": [
    "A few things that helped close more of what we bid: get the proposal out within a day or two, make the scope easy to read, and follow up once a few days later without being pushy.",
  ],
  Pricing: [
    "Pricing really depends on your market and overhead, so I won't throw a number at you. I'd start from your actual costs, add overhead, then decide on markup or margin so you know what you're making on every job.",
  ],
  "Sales process": [
    "The biggest thing for us was speed and clarity: walk the job, send a clean proposal fast, and follow up once. People often go with whoever made it easiest to say yes.",
  ],
  "QuickBooks limits": [
    "QuickBooks is great for the books but its estimates are pretty bare-bones for construction. A lot of guys build the estimate somewhere else and keep QuickBooks for accounting.",
  ],
  "Jobber / alternatives": [
    "Jobber and the bigger platforms are built around scheduling and invoicing as much as estimating, so they can feel like a lot if you mostly need clean bids.",
  ],
  Affordability: [
    "If cost is the main thing, look for something with a free tier so you can try it on a real job before paying for anything.",
  ],
};

const GENERIC_ADVICE = [
  "I'd break it into sections (materials, labor, disposal and permits), price each from your own costs, then add your markup or margin at the end so you can see what you're actually making.",
  "Start from your real costs for materials and labor, add overhead, and only then put your markup on top. That way the number holds up when the customer pushes back.",
];

const OPENERS: Record<string, readonly string[]> = {
  A: ["Good question.", "I've been down this road.", "I've actually been working on this exact problem.", "Been there."],
  B: ["Totally get it.", "That was me for a long time.", "Yeah, this one's common.", "I hear you."],
  C: ["Good question.", "Happy to help with this one.", "Here's how I'd think about it."],
  D: ["Good question.", "Here's what I'd look at."],
};

const BACKGROUND = [
  "I spent about 12 years in sales and almost five in construction",
  "I've been in construction for almost five years, after about 12 in sales",
  "After 12 or so years in sales I spent nearly five in construction, helping a small company grow",
];

const CLOSERS = [
  "If you have any questions or feedback, I'm happy to help.",
  "Happy to answer questions if you have any.",
  "Would love to hear what you think if you try it.",
  "If you try it, I'd genuinely like to hear what's missing.",
];

const DISCLOSURE = /\b(i'?m the founder|i built|i'?m one of the founders|i started|founder of|i made|we built|we launched|my company)\b/i;
export const hasDisclosure = (s: string) => DISCLOSURE.test(s);

const SHORT_TRADE: Record<string, string> = {
  decks: "deck", kitchens: "kitchen", bathrooms: "bathroom", "interior-remodeling": "remodeling", "exterior-remodeling": "exterior remodeling",
  "pressure-washing": "pressure washing", "soft-washing": "soft washing", "general-contracting": "general contracting", handyman: "handyman", other: "",
};

function productBlock(ctx: DraftContext, priority: string): { text: string; link: boolean } {
  const domain = displayDomain();
  const site = ctx.linksAllowed ? trackedUrl(ctx.sourceKey) : domain;
  const bg = pick(ctx.seed, "bg", BACKGROUND);
  const trade = ctx.classification.trade ? (SHORT_TRADE[ctx.classification.trade] ?? tradeName(ctx.classification.trade).toLowerCase()) : null;
  const bgMid = bg.startsWith("I ") || bg.startsWith("I'") ? bg : bg.charAt(0).toLowerCase() + bg.slice(1);
  const what = trade
    ? `It has a ${trade} template, lets you price with markup or margin, and builds a branded proposal you can send or have signed online.`
    : "You put in your own labor and material costs, price with markup or margin, and it builds a branded proposal you can send or have signed online.";
  const free = priority === "A" || priority === "B" ? ` Your first ${plans.starterCredits} bids are free if you want to try it.` : "";
  const lead = pick(ctx.seed, "lead", [
    `Full disclosure, I'm the founder of Built2Bid (${site}).`,
    `Full disclosure: ${bgMid}, and I built Built2Bid (${site}) around the estimating process I was using.`,
    `${bg}, and we recently launched Built2Bid (${site}) based on that workflow. I'm the founder, so take this with that in mind.`,
  ]);
  return { text: `${lead} ${what}${free}`, link: ctx.linksAllowed };
}

/** First reply to a discussion. Returns null when no reply should be suggested at all. */
export function draftFirstReply(ctx: DraftContext): DraftResult | null {
  const c = ctx.classification;
  if (c.priority === "X") return null; // irrelevant: never generate a promotional recommendation
  const advice = c.topics.map((t) => ADVICE[t]).filter(Boolean).slice(0, 2).map((opts, i) => pick(ctx.seed, `adv${i}`, opts!));
  const body: string[] = [pick(ctx.seed, "open", OPENERS[c.priority] ?? OPENERS.C)];
  body.push(...(advice.length ? advice : [pick(ctx.seed, "gen", GENERIC_ADVICE)]));

  const mention = c.priority === "D" ? Boolean(ctx.allowProductMention) : c.productMentionAppropriate && (c.priority !== "C" || c.topics.some((t) => PRODUCT_TOPICS.has(t)));
  let includesLink = false;
  if (mention) {
    const p = productBlock(ctx, c.priority);
    body.push(p.text);
    includesLink = p.link;
    body.push(pick(ctx.seed, "close", CLOSERS));
  } else if (c.priority === "D") {
    body.push("For that kind of work you probably want a dedicated takeoff or commercial estimating tool. Hope that helps.");
  }
  const text = body.join(" ").replace(/\s+/g, " ").replace(/ (?=(Full disclosure|I spent|I've been in|After 12))/, "\n\n").trim();
  const flags = guardDraft(text, { mentionsProduct: mention, linksAllowed: ctx.linksAllowed, replyNumber: 1 });
  if (c.injectionSuspected) flags.push({ kind: "injection_suspected" });
  return { body: text, mentionsProduct: mention, includesLink, flags, needsManualReview: flags.length > 0 };
}

const PRODUCT_TOPICS = new Set(["Estimating software", "Spreadsheets", "Professional proposals", "Time spent quoting", "Scope of work", "Exclusions", "Markup vs margin"]);

// ---------------------------------------------------------------------------------------------
// Reply 2: answer the direct follow-up, then close politely
// ---------------------------------------------------------------------------------------------
const NEEDS_VERIFICATION: [RegExp, string][] = [
  [/\b(quick ?books|qbo|xero|accounting|integrat|api|zapier|sync|import|export to|csv)\b/i, "Asks about integrations or data import/export"],
  [/\b(takeoff|blueprint|plans|cad|pdf plans)\b/i, "Asks about takeoff from plans (not supported)"],
  [/\b(refund|cancel|billing|charged|invoice me|receipt|account|login|log in|sign in|bug|broken|error|doesn'?t work|not working|crash)\b/i, "Support or billing issue: answer personally"],
  [/\b(team|multiple users|employees|seats|crew access)\b/i, "Asks about team accounts"],
  [/\b(tax(es)?|legal|contract law|license|insurance|lien)\b/i, "Legal, tax or licensing question"],
  [/\b(safety|injur|osha|hazard|asbestos|lead paint|structural)\b/i, "Safety-related question: answer carefully and personally"],
];

export interface FollowUpContext {
  seed: string;
  sourceKey: string;
  followUp: string;
  classification: Classification;
  /** Text of reply 1, to avoid repeating the link or the pitch. */
  firstReply: string;
}

export function draftFollowUpReply(ctx: FollowUpContext): DraftResult {
  const q = ctx.followUp;
  const verify = NEEDS_VERIFICATION.find(([r]) => r.test(q));
  const parts: string[] = [pick(ctx.seed, "f-open", ["Good question.", "Thanks for asking.", "Sure thing."])];
  let answered = false;
  if (/\b(how much|price|pricing|cost|costs|expensive|subscription|per month|monthly)\b/i.test(q)) {
    parts.push(`It's free for your first ${plans.starterCredits} bids and ${plans.monthlyCredits} bid a month after that. Unlimited is ${plans.monthlyPriceLabel}/month, or ${plans.annualPriceLabel}/year if you pay annually.`);
    answered = true;
  }
  if (/\b(phone|mobile|ipad|tablet|app store|android|iphone)\b/i.test(q)) {
    parts.push("It runs in the browser, so it works on a phone or tablet. There isn't a separate app store app.");
    answered = true;
  }
  if (/\b(trade|roof|siding|deck|concrete|paint|drywall|electric|kitchen|bath|remodel|pressure|soft ?wash|fence|floor|plumb|hvac)\w*\b/i.test(q) && /\b(do(es)?|work|support|have|handle)\b/i.test(q)) {
    parts.push("It has templates for most residential trades, including roofing, siding, decks, concrete, remodeling, painting, drywall, electrical and pressure/soft washing, and you can add your own items for anything else.");
    answered = true;
  }
  if (/\b(markup|margin)\b/i.test(q)) {
    parts.push("You can price each bid with either markup or margin, and it shows you what you're making either way.");
    answered = true;
  }
  if (/\b(customer|client|homeowner)\b.{0,30}\b(see|sees|shown|view)\b/i.test(q)) {
    parts.push("You decide what the customer sees: every line item, grouped sections, or just one total. Your costs stay private.");
    answered = true;
  }
  if (/\b(sign|signature|e-?sign)\b/i.test(q) && !/\bsign (in|up)\b/i.test(q)) {
    parts.push("Customers can review and e-sign the proposal online.");
    answered = true;
  }
  if (/\b(scope|exclusions?)\b/i.test(q)) {
    parts.push("It can draft the scope of work and exclusions from your line items, and you edit them before sending.");
    answered = true;
  }

  const needsManualReview = Boolean(verify) || !answered;
  const reviewReason = verify?.[1] ?? (!answered ? "Couldn't match the question to a verified answer. Write this one yourself." : undefined);
  if (!answered) parts.push("[Owner: answer the question here. Don't guess if it needs checking.]");
  parts.push(pick(ctx.seed, "f-close", [
    "Thanks for the conversation, and good luck with the busy season.",
    "Appreciate you taking a look. Good luck out there.",
    "Thanks again for the question. Hope it helps.",
  ]));
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  const flags = guardDraft(text, { mentionsProduct: true, linksAllowed: false, replyNumber: 2, previous: ctx.firstReply });
  if (verify) flags.push({ kind: "needs_verification", reason: verify[1] });
  return { body: text, mentionsProduct: true, includesLink: false, flags, needsManualReview: needsManualReview || flags.length > 0, reviewReason };
}

// ---------------------------------------------------------------------------------------------
// Guards shared by the rules engine, the AI writer and owner edits
// ---------------------------------------------------------------------------------------------
const LINK = /\bhttps?:\/\/\S+|\b(?:www\.)?built2bid\.(?:org|com)\b\S*/i;

export function guardDraft(text: string, o: { mentionsProduct: boolean; linksAllowed: boolean; replyNumber: number; previous?: string }): DraftFlag[] {
  const flags: DraftFlag[] = unsupportedClaims(text).map((claim) => ({ kind: "unsupported_claim" as const, claim }));
  const namesProduct = /\bbuilt ?2 ?bid\b/i.test(text);
  if ((o.mentionsProduct || namesProduct) && o.replyNumber === 1 && !hasDisclosure(text)) flags.push({ kind: "missing_disclosure" });
  if (/\[owner:/i.test(text)) flags.push({ kind: "placeholder" });
  const hasUrl = /\bhttps?:\/\//i.test(text);
  if (hasUrl && !o.linksAllowed) flags.push({ kind: "link_not_allowed" });
  if (o.replyNumber > 1 && o.previous && LINK.test(o.previous) && /\bhttps?:\/\/|built2bid\.org/i.test(text)) flags.push({ kind: "repeats_link" });
  return flags;
}

/** Word 3-gram Jaccard similarity, 0..1. Used to stop near-identical promotional replies across threads. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = s.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
    const g = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) g.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    return g;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export const SIMILARITY_LIMIT = 0.6;

/** Highest similarity against recent posted/approved replies; flags when above the limit. */
export function similarityFlag(text: string, recent: string[]): { max: number; flag?: DraftFlag } {
  const max = recent.reduce((m, r) => Math.max(m, similarity(text, r)), 0);
  return { max, flag: max >= SIMILARITY_LIMIT ? { kind: "too_similar", similarity: Math.round(max * 100) / 100 } : undefined };
}

export function flagLabel(f: DraftFlag): string {
  switch (f.kind) {
    case "unsupported_claim": return `Possible unsupported claim: ${f.claim}`;
    case "missing_disclosure": return "Mentions Built2Bid without saying you're the founder";
    case "link_not_allowed": return "Contains a link, but links are not allowed for this source";
    case "too_similar": return `Too similar to a reply you already posted (${Math.round(f.similarity * 100)}% overlap)`;
    case "repeats_link": return "Repeats the website link from your first reply";
    case "needs_verification": return `Needs your personal answer: ${f.reason}`;
    case "placeholder": return "Still has an [Owner: ...] placeholder to replace with your answer";
    case "injection_suspected": return "The discussion text contains instruction-like content. It was treated as data only; double-check the draft.";
  }
}

/** Flags that must be resolved (edited away) before approval, vs. ones the owner can acknowledge. */
export const BLOCKING: DraftFlag["kind"][] = ["missing_disclosure", "link_not_allowed", "too_similar", "placeholder"];
export const blockingFlags = (flags: DraftFlag[]) => flags.filter((f) => BLOCKING.includes(f.kind));
