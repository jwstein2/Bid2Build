import { type Priority } from "./classify";
import { getSource } from "./sources";
import { isClosedForOutreach, type OppStatus } from "./state";

/** Row shapes as stored (public.radar_opportunities / radar_drafts / radar_usage). */
export interface OppRow {
  id: string;
  source_key: string;
  canonical_url: string;
  platform_thread_id: string | null;
  title: string;
  excerpt: string | null;
  posted_at: string | null;
  reply_count: number | null;
  reply_allowed: boolean;
  priority: Priority;
  trade: string | null;
  topics: string[];
  pain_points: string[];
  score: number;
  score_factors: { key: string; label: string; points: number; max: number }[] | null;
  status: OppStatus;
  owner_replies_used: number;
  reopened: boolean;
  reopened_reason: string | null;
  allow_product_mention: boolean;
  injection_suspected: boolean;
  flagged_unsupported: boolean;
  content_removed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface DraftRow {
  id: string;
  opportunity_id: string;
  reply_number: number;
  follow_up_text: string | null;
  parent_reply_ref: string | null;
  body: string;
  engine: "rules" | "ai" | "owner";
  flags: { kind: string; [k: string]: unknown }[];
  flags_acknowledged: boolean;
  similarity_max: number | null;
  status: "draft" | "approved" | "rejected" | "superseded" | "posted_manual" | "publish_pending" | "published" | "publish_failed";
  approved_at: string | null;
  posted_at: string | null;
  posted_url: string | null;
  platform_reply_id: string | null;
  publish_error: string | null;
  created_at: string;
}
export interface UsageRow { kind: string; source_key: string | null; cost_usd: number | string; quota_units: number | null; input_tokens: number | null; output_tokens: number | null; created_at: string }

export const POSTED = new Set(["posted_manual", "published"]);

// ---------------------------------------------------------------------------------------------
// Overview counts
// ---------------------------------------------------------------------------------------------
export function overview(opps: OppRow[], drafts: DraftRow[]) {
  const by = (s: OppStatus) => opps.filter((o) => o.status === s).length;
  const relevant = opps.filter((o) => o.priority !== "X");
  return {
    discovered: opps.length,
    qualified: opps.filter((o) => o.score >= 60 && o.priority !== "X" && o.priority !== "D").length,
    highIntent: opps.filter((o) => o.score >= 80 && o.priority === "A").length,
    newCount: by("new"),
    high: opps.filter((o) => o.score >= 80 && !isClosedForOutreach(o) && o.owner_replies_used === 0).length,
    awaitingReview: by("awaiting_review") + by("approved"),
    active: by("active"),
    followups: by("followup_pending"),
    completed: by("completed"),
    rejected: by("rejected") + by("archived"),
    reviewed: relevant.filter((o) => o.status !== "new").length,
    approved: drafts.filter((d) => d.approved_at).length,
    published: drafts.filter((d) => POSTED.has(d.status)).length,
    followupsReceived: drafts.filter((d) => d.reply_number >= 2).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Source performance
// ---------------------------------------------------------------------------------------------
export function sourcePerformance(opps: OppRow[], drafts: DraftRow[]) {
  const posted = new Map<string, number>();
  const followups = new Map<string, number>();
  const oppSource = new Map(opps.map((o) => [o.id, o.source_key]));
  for (const d of drafts) {
    const s = oppSource.get(d.opportunity_id);
    if (!s) continue;
    if (POSTED.has(d.status)) posted.set(s, (posted.get(s) ?? 0) + 1);
    if (d.reply_number === 2) followups.set(s, (followups.get(s) ?? 0) + 1);
  }
  const keys = [...new Set(opps.map((o) => o.source_key))];
  return keys.map((k) => {
    const mine = opps.filter((o) => o.source_key === k);
    return {
      key: k,
      name: getSource(k)?.name ?? k,
      discovered: mine.length,
      qualified: mine.filter((o) => o.score >= 60 && o.priority !== "X" && o.priority !== "D").length,
      avgScore: mine.length ? Math.round(mine.reduce((n, o) => n + o.score, 0) / mine.length) : 0,
      posted: posted.get(k) ?? 0,
      followups: followups.get(k) ?? 0,
    };
  }).sort((a, b) => b.qualified - a.qualified || b.discovered - a.discovered);
}

// ---------------------------------------------------------------------------------------------
// Market learning: recurring pain points with sample-size context
// ---------------------------------------------------------------------------------------------
const CONTENT_IDEAS: Record<string, { type: string; idea: string }[]> = {
  "Estimating takes too long": [{ type: "Article", idea: "How to build a reusable estimate template for your top three job types" }, { type: "Onboarding", idea: "Start new accounts from a trade template with saved items pre-filled" }],
  "Software is too expensive": [{ type: "Landing page", idea: "Make the free bids and the no-credit-card point more visible above the fold" }, { type: "FAQ", idea: "What does Built2Bid cost compared with doing it in a spreadsheet?" }],
  "Software is hard to learn": [{ type: "Video", idea: "Three-minute first bid walkthrough for one trade" }, { type: "Onboarding", idea: "Shorten the first-bid path; measure time to first finalized bid" }],
  "Dislikes spreadsheets": [{ type: "Article", idea: "Moving your estimating spreadsheet into templates without losing your numbers" }, { type: "Feature request", idea: "Spreadsheet/CSV import of a contractor's existing item list (not built today)" }],
  "Tracking labor": [{ type: "Calculator", idea: "Loaded labor rate calculator (wage, taxes, insurance, unbillable time)" }],
  "Markup confusion": [{ type: "Calculator", idea: "Markup vs margin calculator with a worked example" }, { type: "Article", idea: "Markup vs margin for contractors, with the 25% example" }],
  "Writing scopes": [{ type: "Article", idea: "Scope of work examples by trade" }, { type: "Landing page", idea: "Show the scope and exclusions drafting on the trade pages" }],
  "Proposal formatting": [{ type: "Landing page", idea: "Before/after proposal examples per trade" }],
  "Mobile estimating": [{ type: "Video", idea: "Starting a bid on your phone at the job site" }],
  "Bid revisions": [{ type: "Feature request", idea: "Track revisions and change orders on a bid (check current support first)" }, { type: "Article", idea: "How to handle bid revisions without losing the job" }],
};

export interface PainPointTrend { pain: string; count: number; share: number; examples: { title: string; url: string }[]; ideas: { type: string; idea: string }[] }

export function painPointTrends(opps: OppRow[]): { sample: number; trends: PainPointTrend[]; caveat: string } {
  const sample = opps.filter((o) => o.priority !== "X");
  const map = new Map<string, OppRow[]>();
  for (const o of sample) for (const p of o.pain_points) map.set(p, [...(map.get(p) ?? []), o]);
  const trends = [...map.entries()].map(([pain, rows]) => ({
    pain, count: rows.length, share: sample.length ? rows.length / sample.length : 0,
    examples: rows.slice(0, 3).map((r) => ({ title: r.title, url: r.canonical_url })),
    ideas: CONTENT_IDEAS[pain] ?? [],
  })).sort((a, b) => b.count - a.count);
  const caveat = `Based on ${sample.length} relevant discussion${sample.length === 1 ? "" : "s"} the owner imported. These are anecdotes from people who chose to post, not a representative survey${sample.length < 30 ? ", and the sample is small" : ""}.`;
  return { sample: sample.length, trends, caveat };
}

// ---------------------------------------------------------------------------------------------
// Cost and usage
// ---------------------------------------------------------------------------------------------
export function usageSummary(rows: UsageRow[], budgetUsd: number, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const thisMonth = rows.filter((r) => r.created_at.slice(0, 7) === month);
  const cost = thisMonth.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
  const count = (k: string) => thisMonth.filter((r) => r.kind === k).length;
  return {
    month, costUsd: cost, budgetUsd, remainingUsd: Math.max(0, budgetUsd - cost),
    overBudget: cost >= budgetUsd,
    aiDrafts: count("ai_draft"), aiClassifications: count("ai_classify"), imports: count("import"),
    apiCalls: count("source_api"), quotaUnits: thisMonth.reduce((n, r) => n + (r.quota_units ?? 0), 0),
  };
}

/** Imports today, for the daily processing cap. */
export const importsToday = (rows: UsageRow[], now = new Date()) => rows.filter((r) => r.kind === "import" && r.created_at.slice(0, 10) === now.toISOString().slice(0, 10)).length;

// ---------------------------------------------------------------------------------------------
// Attribution: observed signups tagged utm_campaign=opportunity_radar (first touch only)
// ---------------------------------------------------------------------------------------------
export interface AttributionFact { campaign: string | null; channel: string; estimates: number; finalized: number; paying: boolean }
/**
 * Observed outcomes only: accounts whose FIRST touch carried utm_campaign=opportunity_radar. A reply
 * being posted near a signup is never counted as causing it.
 */
export function radarAttribution(facts: AttributionFact[]) {
  const tagged = facts.filter((f) => (f.campaign ?? "").toLowerCase() === "opportunity_radar");
  const byChannel = new Map<string, number>();
  for (const f of tagged) byChannel.set(f.channel, (byChannel.get(f.channel) ?? 0) + 1);
  return {
    signups: tagged.length,
    firstBids: tagged.filter((f) => f.estimates > 0).length,
    activated: tagged.filter((f) => f.finalized > 0).length,
    paid: tagged.filter((f) => f.paying).length,
    byChannel: [...byChannel.entries()].map(([channel, n]) => ({ channel, n })).sort((a, b) => b.n - a.n),
  };
}

// ---------------------------------------------------------------------------------------------
// Weekly digest
// ---------------------------------------------------------------------------------------------
export function weeklyDigest(opps: OppRow[], drafts: DraftRow[], now = new Date()) {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const recent = opps.filter((o) => Date.parse(o.created_at) >= weekAgo);
  const top = opps
    .filter((o) => !isClosedForOutreach(o) && o.owner_replies_used === 0 && o.priority !== "X" && o.priority !== "D" && o.reply_allowed)
    .sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  const followups = opps.filter((o) => o.status === "followup_pending");
  return { recent, top, followups, trends: painPointTrends(recent.length >= 5 ? recent : opps), postedThisWeek: drafts.filter((d) => POSTED.has(d.status) && d.posted_at && Date.parse(d.posted_at) >= weekAgo).length };
}

export function whyItMatters(o: OppRow): string {
  const parts: string[] = [];
  if (o.priority === "A") parts.push("asking directly for estimating software");
  else if (o.priority === "B") parts.push("frustrated with their current estimating workflow");
  else if (o.priority === "C") parts.push("an estimating question you can answer well");
  if (o.trade) parts.push(`${o.trade.replace(/-/g, " ")} contractor`);
  if (o.reply_count === 0) parts.push("no answers yet");
  if (o.pain_points.length) parts.push(`mentions ${o.pain_points.slice(0, 2).join(" and ").toLowerCase()}`);
  return parts.join(" · ") || "Matches estimating topics";
}
