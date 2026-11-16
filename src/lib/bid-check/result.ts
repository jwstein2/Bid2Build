/**
 * The personalized result: built only from answers still on the path (pathAnswers), led by the main
 * goal, shaped by the trade, kind of job, pain point, follow-up answer and current workflow.
 */
import { getTrade } from "../trades/catalog";
import { getBank, painsFor, specialFor } from "./banks";
import { focusOf, isGoal, mainComplete, pathAnswers, templateSlugOf, tradeLabelOf } from "./engine";
import type { Answers, Goal } from "./types";

export type ExampleKind = "estimate" | "profit" | "proposal" | "pipeline" | "template";

export interface BidCheckResult {
  /** Stable, non-personal key for analytics: goal:template:pain. */
  key: string;
  goal: Goal;
  trade: string;
  templateSlug: string;
  headline: string;
  tackleFirst: string;
  tryNext: string;
  teamTip: string | null;
  example: ExampleKind;
  exampleTitle: string;
  action: { label: string; kind: "open_sample" | "start_bid" | "dashboard"; step?: "estimate" | "proposal" };
  /** Occasional bidders get the free bid first; regular (or unknown) bidders get the 7-day pass first. */
  primary: "pass" | "free_bid";
  freeBidHref: string;
  because: string[];
  /** Follow-up goal: what's live today vs. still being built. */
  followupNote: string | null;
}

const OCCASIONAL = new Set(["0-1", "2-4"]);

const GOAL_HEADLINE: Record<Exclude<Goal, "speed">, string> = {
  profit: "See what you'll make before you send the bid.",
  proposals: "Give your customer a clear scope and price.",
  followup: "See which bids are still open.",
};

function speedHeadline(noun: string, tools: string | undefined): string {
  switch (tools) {
    case "excel": return `Turn your ${noun} spreadsheet into a bid you can send.`;
    case "software": return `Build your next ${noun} bid in fewer steps.`;
    case "quickbooks": return `Price the ${noun} before it ever reaches QuickBooks.`;
    default: return `Turn your ${noun} notes into a bid you can send.`;
  }
}

const GENERIC_TIPS: Record<string, string> = {
  "speed.takeoffs": "Use the quantity calculator beside each Qty field to turn measurements into quantities. It keeps your inputs, so a changed dimension is a quick edit.",
  "speed.prices": "Save your usual items with your own costs once, then pick them instead of looking prices up each time.",
  "speed.retyping": "Type straight into the estimate on your phone during the walkthrough, so there's nothing to retype at night.",
  "speed.writeup": "Let Built2Bid draft the scope of work from your line items, then edit the wording instead of starting from a blank page.",
  "profit.markup": "A 25% markup is a 20% margin. Built2Bid shows both side by side, so you can price one way and check the other.",
  "profit.margin": "Switch pricing to target margin and enter your costs. The customer price is worked out for you, and the margin never drifts.",
  "profit.feel": "Enter your real costs first, then compare the price to your usual number. The gross profit line shows what that number actually earns.",
  "profit.depends": "Set a default markup, then override it on the sections that need more or less on this job.",
  "proposals.included": "Show each section's item names without prices, so customers see what's included without picking apart every line.",
  "proposals.why": "Itemize the section customers question most and keep the rest as package totals.",
  "proposals.materials": "Add the product, color or model to each line's description. It prints under the item on the proposal.",
  "proposals.terms": "Set a payment schedule on the proposal step (deposit, progress, completion), so the timing is in writing.",
  "followup.head": "Get it out of your head: every bid you finish lands in Draft or Ready on your Pipeline, and you move it to Sent the day it goes out.",
  "followup.paper": "Your notebook columns already exist: Draft, Ready to Send, Sent, Awaiting Signature, Won. Move each bid's card as it changes.",
  "followup.sheet": "Your spreadsheet's status column becomes the Pipeline board. Each card shows the bid total and when it last changed.",
  "followup.inbox": "Send proposals for e-signature from Built2Bid. A signature moves the bid to Won on its own, so the open ones are easy to spot.",
  "followup.crm": "Keep leads in your CRM and use Built2Bid's Pipeline for bids: it knows each bid's total, signature status and win rate.",
};

const CUSTOM_PAIN_TEXT: Record<string, { noun: string; lines: string }> = {
  takeoffs: { noun: "measurements and takeoffs", lines: "quantities with the calculator beside Qty" },
  materials: { noun: "materials list", lines: "a saved list of your usual materials" },
  labor: { noun: "labor", lines: "labor as its own lines, by the hour or by the unit" },
  subs: { noun: "sub and supplier quotes", lines: "each quote on its own line with your markup" },
  scope: { noun: "scope", lines: "a written scope built from your line items" },
};

function tackle(goal: Goal, noun: string, painNoun: string, lines: string): string {
  switch (goal) {
    case "speed": return `Start with the ${painNoun}. Set up those lines once (${lines}) so every ${noun} bid starts with them already there.`;
    case "profit": return `Start with the ${painNoun}. Price it as its own labor and material lines (${lines}) so you can see what that part earns before you look at the total.`;
    case "proposals": return `Start with the ${painNoun}. Show that section itemized (${lines}) and keep the rest as package totals, so customers get detail where they have questions.`;
    case "followup": return `Start by marking each ${noun} bid Sent the day it goes out. Then the Sent and Awaiting Signature columns show exactly which customers need a call.`;
  }
}

/** Null until the six main questions are answered. */
export function buildResult(all: Answers): BidCheckResult | null {
  if (!mainComplete(all)) return null;
  const a = pathAnswers(all);
  const f = focusOf(a);
  const goal = isGoal(a.goal) ? a.goal : "speed";
  const templateSlug = templateSlugOf(a, f);
  const trade = tradeLabelOf(f, a);
  const because: string[] = [];

  let noun = "next";
  let painNoun = "hardest part";
  let lines = "the lines you use most";
  let painValue = "none";
  let tip: string | undefined;
  let hasSample = false;

  if (f?.kind === "bank") {
    const b = f.bank;
    noun = b.noun;
    const job = b.jobs.find((j) => j.value === a[`${b.key}.job`]);
    const pain = painsFor(b, job?.value).find((p) => p.value === a[`${b.key}.pain`]);
    because.push(b.label, job?.label ?? "", pain ? `${pain.label} takes longest` : "");
    if (pain) { painNoun = pain.noun; lines = pain.lines; painValue = pain.value; }
    const sp = specialFor(b, goal, pain?.value);
    if (sp) tip = sp.options.find((o) => o.value === a[`${b.key}.follow.${goal}.${pain?.value}`])?.tip;
    hasSample = true;
  } else if (f?.kind === "catalog") {
    const t = getTrade(f.slug);
    noun = (t?.name ?? "").toLowerCase() || "next";
    const group = t?.template.groups.filter((g) => !/^permits?$/i.test(g.name))[Number((a[`${f.slug}.pain`] ?? "g0").slice(1))];
    because.push(t?.name ?? "", group ? `${group.name} takes the most work` : "");
    if (group) { painNoun = group.name.toLowerCase(); lines = group.items.slice(0, 3).map((i) => i.name.toLowerCase()).join(", "); painValue = a[`${f.slug}.pain`]; }
  } else if (f?.kind === "custom") {
    noun = "next";
    const p = CUSTOM_PAIN_TEXT[a["custom.pain"] ?? ""];
    because.push(trade, p ? `${p.noun} takes the most work` : "");
    if (p) { painNoun = p.noun; lines = p.lines; painValue = a["custom.pain"]; }
  }
  if (!tip) tip = GENERIC_TIPS[`${goal}.${a[`follow.${goal}`]}`];
  if (!tip) tip = GENERIC_TIPS[`${goal}.${goal === "followup" ? "head" : goal === "profit" ? "markup" : goal === "proposals" ? "why" : "prices"}`];

  // Workflow: where re-entry happens shapes the "try this" advice for speed.
  const tools = a.tools;
  if (tools) because.push({ notes: "Notes or paper", excel: "Spreadsheets", quickbooks: "QuickBooks", software: "Estimating software", mix: "A mix of tools" }[tools] ?? "");
  let tryNext = tip;
  if (goal === "speed" && (tools === "notes" || tools === "excel" || tools === "mix") && a["follow.speed"] !== "retyping") {
    tryNext += tools === "excel"
      ? " Copy your spreadsheet's line names in once and they're there for every bid after."
      : " Typing notes straight into the estimate also means nothing gets copied twice.";
  }
  if (a["tools.reentry"] === "proposal_books") tryNext += " Built2Bid exports a clean PDF and keeps every finalized version, so invoicing has one source.";

  const team = a["team.problem"];
  const teamTip = team === "handoffs" ? "Everyone works on the same bid in Built2Bid, with every finalized version kept, so nothing lives in one person's notes."
    : team === "pricing" ? "Saved Items & Pricing gives everyone the same item names and costs, so two people pricing the same job land in the same place."
    : team === "both" ? "One shared bid and one saved price list fixes both: the same items, the same costs, and every version kept."
    : null;

  const exampleBy: Record<Goal, ExampleKind> = { speed: "estimate", profit: "profit", proposals: "proposal", followup: "pipeline" };
  const example: ExampleKind = goal === "followup" ? "pipeline" : hasSample ? exampleBy[goal] : "template";
  const exampleTitle = example === "pipeline" ? "Your bid Pipeline (live on every account's dashboard)"
    : example === "template" ? `The Built2Bid ${trade} template`
    : example === "profit" ? "Example estimate: margin and gross profit"
    : example === "proposal" ? "Example proposal: you choose the detail per section"
    : "Example estimate";

  const action: BidCheckResult["action"] = goal === "followup" ? { label: "Open your bid Pipeline", kind: "dashboard" }
    : !hasSample ? { label: `Start a ${trade === "your trade" ? "" : `${trade} `}bid from the template`.replace("  ", " "), kind: "start_bid" }
    : goal === "proposals" ? { label: "Open the example proposal", kind: "open_sample", step: "proposal" }
    : goal === "profit" ? { label: "Open the example and check the margin", kind: "open_sample", step: "estimate" }
    : { label: "Open this example estimate", kind: "open_sample", step: "estimate" };

  const headline = goal === "speed" ? speedHeadline(noun === "next" ? "job" : noun, tools) : GOAL_HEADLINE[goal];

  return {
    key: `${goal}:${templateSlug}:${painValue}`,
    goal, trade, templateSlug, headline,
    tackleFirst: tackle(goal, noun === "next" ? "new" : noun, painNoun, lines),
    tryNext,
    teamTip,
    example, exampleTitle, action,
    primary: a.volume && OCCASIONAL.has(a.volume) ? "free_bid" : "pass",
    freeBidHref: `/start/${templateSlug}`,
    because: because.filter(Boolean),
    followupNote: goal === "followup"
      ? "Live today: the Pipeline board (Draft, Ready to Send, Sent, Awaiting Signature, Won), e-signature status and win-rate analytics. Automatic follow-up reminders aren't built yet. Tell us what you'd want to see on each bid in the bonus questions and it shapes what we build next."
      : null,
  };
}

/** Readable labels for the trade's bank (for tests and the admin view). */
export const bankLabel = (key: string) => getBank(key)?.label ?? key;
