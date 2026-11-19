/**
 * Branching for the bid check. The visible path is recomputed from the answers on every step, so:
 *  - the next question always depends on the answers so far (goal, trade, kind of job, pain point);
 *  - going back and changing an earlier answer reshapes everything after it;
 *  - the result only ever reads answers that are still on the path (see pathAnswers), so a trade the
 *    contractor switched away from can never leak into the recommendation.
 *
 * Main path: always 6 questions. Deeper path: optional bonus questions that sharpen the result or
 * collect feedback.
 */
import { getTrade, trades } from "../trades/catalog";
import { BANKS, SLUG_TO_BANK, deepFor, getBank, painsFor, specialFor, type TradeBank } from "./banks";
import type { Answers, Arrival, Goal, Option, Question } from "./types";

export const MAIN_LENGTH = 6;

export const GOAL_OPTIONS: (Option & { value: Goal })[] = [
  { value: "speed", label: "Bids take too long to put together", hint: "Get bids out faster" },
  { value: "profit", label: "I'm not sure what I'll make on a job", hint: "Check profit before sending" },
  { value: "proposals", label: "My proposals could be clearer", hint: "Clearer scope and price" },
  { value: "followup", label: "I lose track of bids after I send them", hint: "See which bids need follow-up" },
];

/** Trades the "Other trade" question offers (catalog trades without their own hand-written bank). */
export const OTHER_TRADES = ["flooring", "plumbing", "hvac", "windows-doors", "tile", "fencing", "gutters", "landscaping", "masonry", "insulation", "framing", "general-contracting", "handyman", "pressure-washing", "pest-control"];

const TOOLS: Option[] = [
  { value: "notes", label: "Notes or paper" },
  { value: "excel", label: "Excel or Google Sheets" },
  { value: "quickbooks", label: "QuickBooks" },
  { value: "software", label: "Estimating software" },
  { value: "mix", label: "A mix of these" },
];

const GENERIC_FOLLOW: Record<Goal, { prompt: string; options: Option[] }> = {
  speed: { prompt: "Where do you lose the most time?", options: [
    { value: "takeoffs", label: "Measuring and takeoffs" },
    { value: "prices", label: "Looking up prices" },
    { value: "retyping", label: "Retyping notes into a quote" },
    { value: "writeup", label: "Writing it up for the customer" },
  ] },
  profit: { prompt: "Do you price with markup, target margin, or a number that feels right?", options: [
    { value: "markup", label: "Markup on my costs" },
    { value: "margin", label: "A target margin" },
    { value: "feel", label: "A number that feels right" },
    { value: "depends", label: "Depends on the job" },
  ] },
  proposals: { prompt: "What do customers most often ask you to clarify?", options: [
    { value: "included", label: "What's included" },
    { value: "why", label: "Why it costs that much" },
    { value: "materials", label: "Material choices" },
    { value: "terms", label: "Payment terms and timing" },
  ] },
  followup: { prompt: "Where do you track sent bids today?", options: [
    { value: "head", label: "In my head" },
    { value: "paper", label: "Notebook or whiteboard" },
    { value: "sheet", label: "A spreadsheet" },
    { value: "inbox", label: "Email and text threads" },
    { value: "crm", label: "A CRM or other software" },
  ] },
};

const CUSTOM_PAINS: Option[] = [
  { value: "takeoffs", label: "Measuring and takeoffs" },
  { value: "materials", label: "Building the materials list" },
  { value: "labor", label: "Figuring labor" },
  { value: "subs", label: "Getting sub or supplier quotes" },
  { value: "scope", label: "Writing the scope" },
];

export type Focus =
  | { kind: "bank"; key: string; bank: TradeBank }
  | { kind: "catalog"; key: string; slug: string }
  | { kind: "custom"; key: "custom" }
  | null;

export function isGoal(v: unknown): v is Goal {
  return v === "speed" || v === "profit" || v === "proposals" || v === "followup";
}

/** The trade the contractor is improving first, once it's known. */
export function focusOf(a: Answers): Focus {
  const t = a.trade;
  if (!t) return null;
  const bank = getBank(t);
  if (bank) return { kind: "bank", key: bank.key, bank };
  if (t === "multiple") {
    const f = a["multi.first"];
    if (!f) return null;
    if (f === "custom") return { kind: "custom", key: "custom" };
    const b = getBank(f);
    return b ? { kind: "bank", key: b.key, bank: b } : null;
  }
  if (t === "other") {
    const w = a["other.what"];
    if (!w) return null;
    if (w === "custom") return { kind: "custom", key: "custom" };
    return getTrade(w) ? { kind: "catalog", key: w, slug: w } : null;
  }
  return null;
}

/** Trade template behind the focus (and kind of job), for the sample estimate and "start a bid". */
export function templateSlugOf(a: Answers, f: Focus = focusOf(a)): string {
  if (!f || f.kind === "custom") return "other";
  if (f.kind === "catalog") return f.slug;
  const job = f.bank.jobs.find((j) => j.value === a[`${f.key}.job`]);
  return job?.templateSlug ?? f.bank.catalogSlug;
}

export function tradeLabelOf(f: Focus, a: Answers): string {
  if (!f) return "your trade";
  if (f.kind === "bank") return f.bank.label;
  if (f.kind === "catalog") return getTrade(f.slug)?.name ?? "your trade";
  return a["custom.describe"]?.trim() || "your trade";
}

function tradeQuestion(): Question {
  return {
    id: "trade", phase: "main", kind: "single", prompt: "What kind of work do you bid?",
    help: "Pick the one you bid most. You can change it later.",
    options: [...BANKS.map((b) => ({ value: b.key, label: b.label })), { value: "other", label: "Other trade" }, { value: "multiple", label: "Multiple trades" }],
  };
}

function catalogJobs(slug: string): Option[] {
  const t = getTrade(slug);
  return [...(t?.projects ?? []).map((p, i) => ({ value: `p${i}`, label: p })), { value: "mix", label: "A mix of these" }];
}
function catalogPains(slug: string): Option[] {
  const t = getTrade(slug);
  return (t?.template.groups ?? []).filter((g) => !/^permits?$/i.test(g.name)).slice(0, 6).map((g, i) => ({ value: `g${i}`, label: g.name }));
}

/** The six main questions for these answers (questions after an unanswered branch are left out). */
export function mainPath(a: Answers): Question[] {
  const goal = isGoal(a.goal) ? a.goal : null;
  const qs: Question[] = [
    { id: "goal", phase: "main", kind: "single", prompt: "What's slowing down your bids?", help: "Pick the one you'd fix first.", options: GOAL_OPTIONS },
    tradeQuestion(),
  ];
  if (a.trade === "multiple") {
    qs.push({ id: "multi.first", phase: "main", kind: "single", prompt: "Which trade do you want to improve first?", help: "We'll start there. You can come back for the others.", options: [...BANKS.map((b) => ({ value: b.key, label: b.label })), { value: "custom", label: "Something else" }] });
  } else if (a.trade === "other") {
    qs.push({ id: "other.what", phase: "main", kind: "single", prompt: "What do you build?", options: [...OTHER_TRADES.filter((s) => getTrade(s)).map((s) => ({ value: s, label: getTrade(s)!.name })), { value: "custom", label: "Something else" }] });
  }
  const f = focusOf(a);
  if (!f) return qs;
  if (f.kind === "bank") {
    const b = f.bank;
    const job = a[`${b.key}.job`];
    qs.push({ id: `${b.key}.job`, phase: "main", kind: "single", scope: b.key, prompt: b.jobPrompt, options: b.jobs.map(({ value, label }) => ({ value, label })) });
    if (!job || !b.jobs.some((j) => j.value === job)) return qs;
    qs.push({ id: `${b.key}.pain`, phase: "main", kind: "single", scope: b.key, prompt: b.painPrompt, options: painsFor(b, job).map(({ value, label }) => ({ value, label })) });
    const pain = a[`${b.key}.pain`];
    if (!goal || !pain || !painsFor(b, job).some((p) => p.value === pain)) return qs;
    const sp = specialFor(b, goal, pain);
    if (sp) qs.push({ id: `${b.key}.follow.${goal}.${pain}`, phase: "main", kind: "single", scope: b.key, prompt: sp.prompt, options: sp.options.map(({ value, label }) => ({ value, label })) });
    else qs.push({ id: `follow.${goal}`, phase: "main", kind: "single", ...GENERIC_FOLLOW[goal] });
  } else if (f.kind === "catalog") {
    const name = getTrade(f.slug)?.name ?? "this";
    qs.push({ id: `${f.slug}.job`, phase: "main", kind: "single", scope: f.slug, prompt: `Which ${name.toLowerCase()} jobs do you bid most?`, options: catalogJobs(f.slug) });
    if (!a[`${f.slug}.job`]) return qs;
    qs.push({ id: `${f.slug}.pain`, phase: "main", kind: "single", scope: f.slug, prompt: `Which part of a ${name.toLowerCase()} estimate takes the most work?`, options: catalogPains(f.slug) });
    if (!goal || !a[`${f.slug}.pain`]) return qs;
    qs.push({ id: `follow.${goal}`, phase: "main", kind: "single", ...GENERIC_FOLLOW[goal] });
  } else {
    qs.push({ id: "custom.describe", phase: "main", kind: "text", options: [], scope: "custom", prompt: "What do you build?", placeholder: "For example: sunrooms, epoxy floors, docks", help: "A few words is plenty. Please don't include names or contact details." });
    if (!a["custom.describe"]?.trim()) return qs;
    qs.push({ id: "custom.pain", phase: "main", kind: "single", scope: "custom", prompt: "Which parts of the estimate take the most work?", options: CUSTOM_PAINS });
    if (!goal || !a["custom.pain"]) return qs;
    qs.push({ id: `follow.${goal}`, phase: "main", kind: "single", ...GENERIC_FOLLOW[goal] });
  }
  // Six questions in total: the tools question fills the last slot on a direct trade path; on the
  // multiple/other paths that slot went to the extra trade question, so tools moves to the deeper path.
  if (qs.length < MAIN_LENGTH) qs.push(toolsQuestion("main"));
  return qs;
}

function toolsQuestion(phase: "main" | "deep"): Question {
  return { id: "tools", phase, kind: "single", prompt: "What do you use to put bids together today?", options: TOOLS };
}

/** Bonus questions (optional), given the answers so far. */
export function deepPath(a: Answers): Question[] {
  const main = mainPath(a);
  const qs: Question[] = [
    { id: "volume", phase: "deep", kind: "single", prompt: "How many bids do you send in a typical month?", options: [
      { value: "0-1", label: "0–1" }, { value: "2-4", label: "2–4" }, { value: "5-10", label: "5–10" },
      { value: "11-25", label: "11–25" }, { value: "26+", label: "26 or more" }, { value: "varies", label: "It varies" },
    ] },
    { id: "who", phase: "deep", kind: "single", prompt: "Who puts your bids together?", options: [
      { value: "solo", label: "Just me" }, { value: "pair", label: "Me and someone else" },
      { value: "estimator", label: "A dedicated estimator" }, { value: "varies", label: "Different people, depending on the job" },
    ] },
  ];
  if (a.who && a.who !== "solo") {
    qs.push({ id: "team.problem", phase: "deep", kind: "single", prompt: "Is anything slipping between people?", options: [
      { value: "handoffs", label: "Details get lost in handoffs" }, { value: "pricing", label: "Prices aren't consistent" },
      { value: "both", label: "Both" }, { value: "neither", label: "Neither, it works fine" },
    ] });
  }
  if (!main.some((q) => q.id === "tools")) qs.push(toolsQuestion("deep"));
  if (a.tools === "software") {
    qs.push({ id: "tools.wish", phase: "deep", kind: "single", prompt: "What do you wish your estimating software made easier?", options: [
      { value: "setup", label: "Setting up each new job" }, { value: "proposals", label: "Better-looking proposals" },
      { value: "margin", label: "Knowing my margin" }, { value: "tracking", label: "Tracking sent bids" }, { value: "cost", label: "It's too expensive or complicated" },
    ] });
  } else if (a.tools) {
    qs.push({ id: "tools.reentry", phase: "deep", kind: "single", prompt: "Where do you end up typing the same information twice?", options: [
      { value: "notes_sheet", label: "Notes into a spreadsheet" }, { value: "sheet_proposal", label: "Spreadsheet into a proposal" },
      { value: "proposal_books", label: "Proposal into QuickBooks or invoices" }, { value: "customer", label: "Customer info everywhere" }, { value: "none", label: "I don't, really" },
    ] });
  }
  const f = focusOf(a);
  if (f?.kind === "bank") {
    const d = deepFor(f.bank, a[`${f.key}.job`]);
    if (d) qs.push({ id: `${f.key}.deep`, phase: "deep", kind: "single", scope: f.key, prompt: d.prompt, options: d.options });
  } else if (f?.kind === "catalog") {
    qs.push({ id: `${f.slug}.deep`, phase: "deep", kind: "single", scope: f.slug, prompt: "Which part would you most like a ready-made template for?", options: catalogPains(f.slug) });
  }
  if (a.goal === "followup") {
    qs.push({ id: "followup.track", phase: "deep", kind: "single", prompt: "What would you want to see on each open bid?", options: [
      { value: "sent", label: "When it was sent" }, { value: "next", label: "When to follow up next" },
      { value: "viewed", label: "Whether they opened it" }, { value: "reason", label: "Why I won or lost" },
    ] });
  }
  qs.push({ id: "feedback", phase: "deep", kind: "text", options: [], optional: true, prompt: "Anything else that would make bidding easier?", placeholder: "Optional", help: "We read every answer. Please don't include names or contact details." });
  return qs;
}

/** Main path complete: every one of the six questions answered. */
export function mainComplete(a: Answers): boolean {
  const qs = mainPath(a);
  return qs.length === MAIN_LENGTH && qs.every((q) => answered(q, a));
}

export function answered(q: Question, a: Answers): boolean {
  const v = a[q.id];
  if (q.kind === "text") return q.optional ? v !== undefined : Boolean(v?.trim());
  return v !== undefined && q.options.some((o) => o.value === v);
}

/** Only the answers that are on the current path (main + bonus). */
export function pathAnswers(a: Answers): Answers {
  const out: Answers = {};
  for (const q of [...mainPath(a), ...deepPath(a)]) if (answered(q, a)) out[q.id] = a[q.id];
  return out;
}

const TRADE_KEYS = new Set(["trade", "multi.first", "other.what"]);
const focusKey = (f: Focus) => (f ? f.key : null);

/**
 * Record an answer. Switching trade clears the old trade's answers (and its sub-question) but keeps
 * everything that still applies: goal, tools, volume, team, feedback.
 */
export function setAnswer(a: Answers, id: string, value: string): Answers {
  const next: Answers = { ...a, [id]: value };
  if (!TRADE_KEYS.has(id)) return next;
  if (id === "trade") {
    if (value !== "multiple") delete next["multi.first"];
    if (value !== "other") delete next["other.what"];
  }
  const before = focusKey(focusOf(a));
  const after = focusKey(focusOf(next));
  if (before && before !== after) {
    for (const k of Object.keys(next)) if (k.startsWith(`${before}.`)) delete next[k];
  }
  return next;
}

/** Turn a link's trade hint (bank key or catalog slug) into the preselection for each question. */
export function hintSelections(hint: string | null): Answers {
  if (!hint) return {};
  const h = hint.toLowerCase();
  if (getBank(h)) return { trade: h };
  const m = SLUG_TO_BANK[h];
  if (m) return m.job ? { trade: m.bank, [`${m.bank}.job`]: m.job } : { trade: m.bank };
  if (OTHER_TRADES.includes(h) && getTrade(h)) return { trade: "other", "other.what": h };
  if (h === "multiple" || h === "other") return { trade: h };
  return {};
}

const clean = (v: string | null | undefined, max = 64) => {
  const s = (v ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]*$/.test(s) && s.length <= max ? s : null;
};

/** Read the link parameters. Unknown or messy values are dropped, never echoed. */
export function parseArrival(sp: Record<string, string | string[] | undefined>): Arrival {
  const one = (k: string) => { const v = sp[k]; return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined; };
  const hint = clean(one("trade") ?? one("t"));
  const validHint = hint && Object.keys(hintSelections(hint)).length ? hint : null;
  const medium = clean(one("utm_medium"));
  const src = clean(one("src"));
  const source = src && ["fb_page", "fb_messenger", "fb_group"].includes(src) ? src
    : medium === "messenger" ? "fb_messenger" : medium === "group" ? "fb_group"
    : clean(one("utm_source")) === "facebook" ? "fb_page" : null;
  return { campaign: clean(one("c")) ?? clean(one("utm_campaign")), source, content: clean(one("utm_content"), 100), tradeHint: validHint };
}

/** Every catalog trade slug the questionnaire knows (for tests). */
export const KNOWN_SLUGS = trades.map((t) => t.slug);
