/**
 * Low-cost, deterministic classification and scoring for Opportunity Radar. Runs on every imported
 * discussion with no AI call. Forum text is untrusted: it is only ever matched against patterns here,
 * never executed or followed.
 *
 * The 0-100 score is a review-priority signal for the owner, NOT a purchase probability.
 */

export type Priority = "A" | "B" | "C" | "D" | "X";
export const PRIORITY_LABEL: Record<Priority, string> = {
  A: "A · Buying intent",
  B: "B · Workflow frustration",
  C: "C · Educational",
  D: "D · Poor product fit",
  X: "Not relevant",
};

export interface DiscussionInput {
  title: string;
  text: string;
  postedAt?: string | null;
  /** How many answers the thread already has, if the owner noted it. */
  replyCount?: number | null;
  /** Whether the source/community allows a reply at all (owner can mark "no replies allowed"). */
  replyAllowed?: boolean;
}

export interface Classification {
  priority: Priority;
  trade: string | null;
  topics: string[];
  painPoints: string[];
  constructionRelevant: boolean;
  poorFitReasons: string[];
  /** Built2Bid may be mentioned at all (never for X; for D only with owner override). */
  productMentionAppropriate: boolean;
  injectionSuspected: boolean;
}

export interface Score {
  total: number;
  band: "high" | "potential" | "research" | "archive";
  factors: { key: string; label: string; points: number; max: number }[];
}

// ---------------------------------------------------------------------------------------------
// Prompt-injection hygiene
// ---------------------------------------------------------------------------------------------
const INJECTION = /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all|your)\b.{0,40}\b(instructions?|rules?|prompts?)\b|\b(system prompt|you are now|act as|new instructions|developer mode|jailbreak)\b|<\/?(system|assistant|instructions?|discussion)>/i;

export const looksLikeInjection = (s: string) => INJECTION.test(s);

/**
 * Prepare untrusted forum text for storage or for an AI prompt: strip control characters, neutralize
 * anything that could close our delimiter tags, collapse whitespace, and cap the length.
 */
export function sanitizeUntrusted(s: string, max = 1500): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/</g, "‹").replace(/>/g, "›")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

// ---------------------------------------------------------------------------------------------
// Lexicons
// ---------------------------------------------------------------------------------------------
const TRADES: [string, RegExp][] = [
  ["roofing", /\broof(s|ing|er|ers)?\b|\bshingles?\b|\breroof/i],
  ["siding", /\bsiding\b|\bhardie\b|\bvinyl siding\b/i],
  ["decks", /\bdecks?\b|\bporch(es)?\b|\btrex\b|\bpergola/i],
  ["concrete", /\bconcrete\b|\bflatwork\b|\bdriveway pour|\bslabs?\b|\bpatio pour/i],
  ["kitchens", /\bkitchens?\b/i],
  ["bathrooms", /\bbath(room)?s?\b|\bshower remodel/i],
  ["drywall", /\bdrywall\b|\bsheetrock\b|\btaping\b/i],
  ["painting", /\bpaint(ing|er|ers)?\b|\bcabinet refinish/i],
  ["electrical", /\belectric(al|ian|ians)?\b|\bpanel upgrade|\brewire/i],
  ["pressure-washing", /\bpressure ?wash(ing)?\b|\bpower ?wash(ing)?\b/i],
  ["soft-washing", /\bsoft ?wash(ing)?\b/i],
  ["interior-remodeling", /\bremodel(ing|er|ers)?\b|\brenovation/i],
  ["flooring", /\bfloor(ing)?\b|\blvp\b|\bhardwood\b/i],
  ["fencing", /\bfenc(e|es|ing)\b/i],
  ["plumbing", /\bplumb(ing|er|ers)\b/i],
  ["hvac", /\bhvac\b|\bfurnace\b|\bmini ?split/i],
  ["gutters", /\bgutters?\b/i],
  ["tree-removal", /\btree (removal|removals|service|services|company|companies)\b|\bstump (grinding|removal)\b|\barborists?\b/i],
  ["tree-trimming", /\btree (trimming|pruning|trimmers?)\b|\bprun(e|ing) (the )?trees?\b/i],
  ["pest-control", /\bpest (control|management|company|companies)\b|\bexterminat(or|ors|ing|ion)\b|\btermite (treatment|inspection|bait|company)\b/i],
  ["landscaping", /\blandscap(e|ing|er)\b|\blawn care\b|\bhardscap/i],
  ["general-contracting", /\bgeneral contractor\b|\b\bGC\b/],
  ["handyman", /\bhandyman\b/i],
];
const PRIORITY_TRADES = new Set(["roofing", "siding", "decks", "concrete", "interior-remodeling", "kitchens", "bathrooms", "drywall", "painting", "electrical", "pressure-washing", "soft-washing"]);

const CONSTRUCTION = /\b(contractor|contracting|subcontract|construction|remodel|bid(s|ding)?|estimat(e|es|ing|or)|quote(s|d)?|proposal|job ?site|customer|homeowner|client|crew|trade|materials?|labor|markup|margin|scope of work|exclusions?|change orders?)\b/i;

const TOPICS: [string, RegExp][] = [
  ["Estimating software", /\b(estimating|estimate|bidding|quoting|proposal)\s+(software|app|program|tool|platform)s?\b|\bsoftware\b.{0,40}\b(estimat|bid|quot)/i],
  ["Spreadsheets", /\bspreadsheets?\b|\bexcel\b|\bgoogle sheets?\b/i],
  ["Markup vs margin", /\bmark ?up\b|\bmargin\b|\bprofit\b.{0,20}\b(percent|%)/i],
  ["Labor estimating", /\blabor\b.{0,30}\b(cost|rate|hours|estimat|price|track)|\bman ?hours\b/i],
  ["Material estimating", /\bmaterials?\b.{0,30}\b(cost|list|takeoff|estimat|price|quantit)/i],
  ["Professional proposals", /\bproposals?\b|\bprofessional(-| )looking\b|\bbranded\b|\blook (more )?professional\b/i],
  ["Scope of work", /\bscope of work\b|\bscopes?\b.{0,20}\bwrit/i],
  ["Exclusions", /\bexclusions?\b|\bnot included\b/i],
  ["Winning bids", /\b(win(ning)?|lose|losing|lost)\b.{0,20}\b(bids?|jobs?|work)\b|\bclose rate\b/i],
  ["Pricing", /\bhow (much|do you|should i) (charge|price)\b|\bpricing\b|\bprice per\b/i],
  ["Sales process", /\bsales process\b|\bfollow(ing)? up\b.{0,20}\b(quote|bid|estimate)|\bclos(e|ing) (the )?(deal|sale)/i],
  ["QuickBooks limits", /\bquick ?books\b|\bqbo\b/i],
  ["Jobber / alternatives", /\bjobber\b|\bhousecall pro\b|\bservicetitan\b|\bbuildertrend\b|\bjoist\b|\bestimate rocket\b|\bcontractor foreman\b|\bknowify\b/i],
  ["Time spent quoting", /\b(hours|forever|all night|weekends?|too long|so long|takes? (me )?(way )?too much time)\b.{0,40}\b(estimat|quot|bid|proposal)|\b(estimat|quot|bid|proposal)\w*\b.{0,40}\b(hours|forever|too long|so long)\b/i],
  ["Affordability", /\b(cheap|affordable|inexpensive|budget|expensive|cost too much|pricey|free)\b/i],
];

const PAIN_POINTS: [string, RegExp][] = [
  ["Estimating takes too long", /\b(hours|forever|all night|weekends?|too long|so long|takes? (me )?(way )?too much time|time[- ]consuming)\b/i],
  ["Software is too expensive", /\b(too expensive|cost too much|pricey|can'?t afford|overpriced|per month is crazy|\$\d{3,}\s*(\/|a|per)\s*mo)/i],
  ["Software is hard to learn", /\b(learning curve|hard to learn|too complicated|confusing|clunky|overkill|bloated)\b/i],
  ["Dislikes spreadsheets", /\bspreadsheets?\b|\bexcel\b/i],
  ["Tracking labor", /\blabor\b.{0,30}\b(track|cost|hours|rate)/i],
  ["Markup confusion", /\bmark ?up\b.{0,40}\b(margin|vs|versus|difference|confus)|\bmargin\b.{0,40}\bmark ?up\b/i],
  ["Writing scopes", /\bscope of work\b|\bwrit(e|ing) (a |the )?scopes?\b/i],
  ["Proposal formatting", /\b(look(s)? (more )?professional|format(ting)?|template|branded|logo)\b/i],
  ["Mobile estimating", /\b(phone|mobile|ipad|tablet|on site|in the truck)\b/i],
  ["Bid revisions", /\b(revis(e|ion|ions)|change orders?|update the (quote|estimate|bid))\b/i],
];

const BUYING = [
  /\bwhat (estimating |bidding |quoting |proposal )?(software|app|program|tools?)\b.{0,40}\b(use|recommend|using)\b/i,
  /\b(recommend|suggest|looking for|need|switch(ing)? to|alternative to|replace)\b.{0,50}\b(software|app|program|tool|platform|system)\b/i,
  /\b(software|app|program|tool)\b.{0,40}\b(recommend|suggestions?|worth it)\b/i,
  /\balternatives? to\b.{0,30}\b(spreadsheets?|excel|quick ?books|jobber|buildertrend|servicetitan|housecall)/i,
  /\banything (better|cheaper|simpler) than\b/i,
  /\bsomething that (creates?|makes?|builds?|generates?)\b.{0,40}\b(proposals?|estimates?|bids?|quotes?)/i,
];
const FRUSTRATION = [
  /\b(estimates?|bids?|quotes?|proposals?)\b.{0,30}\b(take|takes|taking)\b.{0,15}\b(forever|hours|too long|so long)/i,
  /\bhow do (you|y'?all|guys)\b.{0,30}\b(organize|track|keep track|manage|handle)\b.{0,30}\b(labor|materials?|costs?|estimates?|bids?)/i,
  /\b(more professional|look professional|professional looking)\b/i,
  /\b(tired of|sick of|hate|struggl(e|ing)|frustrat)\w*\b.{0,40}\b(estimat|bid|quot|proposal|paperwork|spreadsheet)/i,
  /\b(spending|spend|wasting)\b.{0,20}\b(hours|nights|weekends)\b/i,
];
const EDUCATIONAL = [
  /\bhow (do|should|would) (i|you)\b.{0,40}\b(estimate|price|bid|quote|calculate|charge|figure)/i,
  /\b(markup|margin)\b.{0,40}\b(vs|versus|difference|calculate|how)/i,
  /\bwhat (exclusions|should).{0,40}\b(include|estimate|bid|proposal)/i,
  /\bscope of work\b/i,
];
const POOR_FIT: [string, RegExp][] = [
  ["Automated CAD/blueprint takeoff", /\b(take ?off|takeoffs)\b.{0,40}\b(plans?|blueprints?|pdf|cad|drawings?)|\b(cad|blueprints?|bluebeam|plan ?swift|stack ct|on-?screen takeoff)\b/i],
  ["Advanced commercial estimating", /\b(commercial|industrial)\b.{0,30}\b(estimating|bids?|projects?)\b|\bprevailing wage\b|\bbid bonds?\b|\bgmp\b|\bdavis[- ]bacon\b/i],
  ["MEP quantity extraction", /\b(mep|ductwork takeoff|electrical takeoff|plumbing takeoff|quantity extraction)\b/i],
  ["Enterprise ERP replacement", /\b(erp|sage 300|viewpoint|vista|procore|cmic|spectrum|acumatica|job costing system)\b/i],
  ["Academic coursework", /\b(homework|assignment|class|course|professor|exam|textbook|student)\b/i],
];

const anyMatch = (rs: RegExp[], s: string) => rs.some((r) => r.test(s));

export function classify(d: DiscussionInput): Classification {
  const s = `${d.title}\n${d.text}`;
  const tradeHit = TRADES.find(([, r]) => r.test(s));
  const topics = TOPICS.filter(([, r]) => r.test(s)).map(([t]) => t);
  const painPoints = PAIN_POINTS.filter(([, r]) => r.test(s)).map(([t]) => t);
  const poorFitReasons = POOR_FIT.filter(([, r]) => r.test(s)).map(([t]) => t);
  const constructionRelevant = CONSTRUCTION.test(s) || Boolean(tradeHit);
  const estimatingRelated = topics.length > 0 || /\b(estimat|bid|quot|proposal)/i.test(s);

  let priority: Priority;
  if (!constructionRelevant || !estimatingRelated) priority = "X";
  else if (poorFitReasons.length) priority = "D";
  else if (anyMatch(BUYING, s)) priority = "A";
  else if (anyMatch(FRUSTRATION, s)) priority = "B";
  else if (anyMatch(EDUCATIONAL, s) || topics.length) priority = "C";
  else priority = "X";

  return {
    priority,
    trade: tradeHit?.[0] ?? null,
    topics,
    painPoints: priority === "X" ? [] : painPoints,
    constructionRelevant,
    poorFitReasons,
    productMentionAppropriate: priority === "A" || priority === "B" || priority === "C",
    injectionSuspected: looksLikeInjection(s),
  };
}

const PRIORITY_POINTS: Record<Priority, number> = { A: 30, B: 20, C: 10, D: 3, X: 0 };

export function score(d: DiscussionInput, c: Classification, now = new Date()): Score {
  const f: Score["factors"] = [];
  const add = (key: string, label: string, points: number, max: number) => f.push({ key, label, points: Math.max(0, Math.min(max, Math.round(points))), max });

  add("intent", "Explicit software buying intent", PRIORITY_POINTS[c.priority], 30);
  add("construction", "Construction business relevance", c.constructionRelevant ? 10 : 0, 10);
  add("trade", "Supported trade", c.trade ? (PRIORITY_TRADES.has(c.trade) ? 10 : 7) : 4, 10);
  add("problem", "Specific problem described", Math.min(10, c.topics.length * 3 + c.painPoints.length * 2), 10);

  let recency = 5; // unknown date: neutral
  if (d.postedAt) {
    const days = (now.getTime() - new Date(d.postedAt).getTime()) / 86_400_000;
    recency = !Number.isFinite(days) ? 5 : days <= 3 ? 10 : days <= 14 ? 8 : days <= 45 ? 5 : days <= 180 ? 2 : 0;
  }
  add("recency", "Recentness", recency, 10);

  const rc = d.replyCount;
  add("unanswered", "Question still open", rc == null ? 3 : rc === 0 ? 5 : rc <= 5 ? 4 : rc <= 20 ? 2 : 0, 5);
  add("capability", "Product capability match", c.priority === "D" ? 0 : c.priority === "X" ? 0 : Math.min(10, 4 + c.topics.filter((t) => CAPABILITY_TOPICS.has(t)).length * 3), 10);
  add("allowed", "A response is allowed", d.replyAllowed === false ? 0 : 10, 10);
  add("answerable", "A useful answer is likely", c.priority === "X" ? 0 : c.priority === "D" ? 1 : 5, 5);

  let total = f.reduce((n, x) => n + x.points, 0);
  // Hard caps: never let an irrelevant, poor-fit or no-reply discussion reach the review bands.
  if (c.priority === "X") total = Math.min(total, 25);
  if (c.priority === "D") total = Math.min(total, 45);
  if (d.replyAllowed === false) total = Math.min(total, 39);
  total = Math.max(0, Math.min(100, total));
  return { total, band: band(total), factors: f };
}

const CAPABILITY_TOPICS = new Set(["Estimating software", "Spreadsheets", "Markup vs margin", "Labor estimating", "Material estimating", "Professional proposals", "Scope of work", "Exclusions", "Time spent quoting", "Affordability", "QuickBooks limits", "Jobber / alternatives"]);

export function band(total: number): Score["band"] {
  return total >= 80 ? "high" : total >= 60 ? "potential" : total >= 40 ? "research" : "archive";
}
export const BAND_LABEL: Record<Score["band"], string> = { high: "High-priority review", potential: "Potential opportunity", research: "Research / educational", archive: "Archive" };
