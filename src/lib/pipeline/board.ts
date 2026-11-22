/**
 * Contractor sales pipeline (Bids dashboard): board columns, allowed moves, next actions, totals and
 * historical analytics. Pure functions: the server rules live in SQL (set_estimate_stage), these decide
 * what the UI offers and how numbers are counted.
 *
 * Four separate facts about a bid are combined here, never merged into one stored field:
 *   - pipeline stage (what the contractor says; estimates.pipeline_stage)
 *   - document status (draft / finalized / archived)
 *   - signing status (derived from signing_requests and signatures)
 *   - won date (estimates.won_at, or the e-signature time)
 * The board column is derived from them. A real signature always places the bid at Won or later; a manual
 * move to Won is labeled "Approved manually" and never pretends to be a signature.
 */
import type { BidSigning } from "@/lib/esign/status";
import { calendarHref } from "@/lib/projects/calendar-link";

export const STAGES = ["draft", "ready_for_review", "approved", "sent", "pending", "won", "scheduled", "in_progress", "completed", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const isStage = (s: unknown): s is Stage => typeof s === "string" && (STAGES as readonly string[]).includes(s);

/** Most bids the Bids dashboard loads for the board (newest activity first). Stage searches past it use universal search. */
export const BOARD_LOAD_LIMIT = 500;
export const isColumn = (s: unknown): s is Column => typeof s === "string" && (COLUMNS as readonly string[]).includes(s);

export const COLUMNS = ["draft", "ready", "sent", "awaiting", "won", "scheduled", "in_progress", "completed", "lost"] as const;
export type Column = (typeof COLUMNS)[number];
/** The board: selling columns, then the job columns. Lost is shown separately. */
export const SALES_COLUMNS: Column[] = ["draft", "ready", "sent", "awaiting", "won"];
export const JOB_COLUMNS: Column[] = ["scheduled", "in_progress", "completed"];

export const COLUMN_LABELS: Record<Column, string> = {
  draft: "Draft", ready: "Ready to Send", sent: "Sent", awaiting: "Awaiting Signature", won: "Approved / Won",
  scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", lost: "Lost / Declined",
};
export const COLUMN_HINTS: Record<Column, string> = {
  draft: "Estimates you're still building.",
  ready: "Finished proposals that haven't gone to the customer yet.",
  sent: "Proposals the customer has received.",
  awaiting: "Out for e-signature, or waiting on the customer's decision.",
  won: "E-signed, or approved by the customer and marked won by you.",
  scheduled: "Won jobs with a start date.",
  in_progress: "Work has started.",
  completed: "Work is finished.",
  lost: "The customer declined, or the job was cancelled.",
};

const ORDER: Record<Column, number> = { draft: 0, ready: 1, sent: 2, awaiting: 3, won: 4, scheduled: 5, in_progress: 6, completed: 7, lost: 99 };
const WON_FAMILY: Column[] = ["won", "scheduled", "in_progress", "completed"];
export const isWonColumn = (c: Column) => WON_FAMILY.includes(c);
const OPEN: Column[] = ["draft", "ready", "sent", "awaiting"];

export interface BoardBid {
  id: string; title: string; customer: string; number: string; trades: string[];
  status: "draft" | "finalized" | "archived";
  stage: Stage;
  createdAt: string; updatedAt: string; stageChangedAt: string | null;
  wonAt: string | null; lostReason: string | null;
  latestVersion: { id: string; number: number; total: number; subtotal: number | null; cost: number | null } | null;
  signing: BidSigning | null;
  /** Searchable only (pipeline mini search); never shown on cards. Optional: older loaders leave them out. */
  customerEmail?: string | null; address?: string | null;
  /** The bid's project schedule (Projects), when one exists: lets job cards open the calendar or project. */
  scheduleId?: string | null;
}

export function stageColumn(stage: Stage, status: BoardBid["status"]): Column {
  switch (stage) {
    case "draft": return status === "finalized" ? "ready" : "draft";
    case "ready_for_review": case "approved": return "ready";
    case "sent": return "sent";
    case "pending": return "awaiting";
    default: return stage;
  }
}

/** Where the bid sits on the board. Signing evidence only ever moves a bid forward, never back. */
export function columnOf(b: BoardBid): Column {
  const base = stageColumn(b.stage, b.status);
  if (base === "lost") return "lost";
  if (b.signing?.signed) return ORDER[base] >= ORDER.won ? base : "won";
  if (b.signing?.state === "awaiting" && ORDER[base] < ORDER.awaiting) return "awaiting";
  return base;
}

/** The stage a move into `col` writes. Ready keeps an Enterprise "approved" stage instead of resetting it. */
export function stageForColumn(col: Column, b: Pick<BoardBid, "stage">): Stage {
  switch (col) {
    case "ready": return b.stage === "approved" ? "approved" : "ready_for_review";
    case "awaiting": return "pending";
    default: return col;
  }
}

/** Approval shown on Won cards: a verified e-signature, or the contractor's manual approval. */
export function approvalOf(b: BoardBid): { kind: "esign"; at: string; versionNumber: number } | { kind: "manual"; at: string | null } | null {
  const col = columnOf(b);
  if (!isWonColumn(col)) return null;
  if (b.signing?.signed) return { kind: "esign", at: b.signing.signed.at, versionNumber: b.signing.signed.versionNumber };
  return { kind: "manual", at: b.wonAt };
}

/** Bid value: the signed total when signed, otherwise the latest finalized version. Unexported drafts have none. */
export const valueOf = (b: BoardBid): number | null =>
  b.signing?.signed ? b.signing.signed.total : b.latestVersion ? b.latestVersion.total : null;

export const lastActivity = (b: BoardBid): string =>
  [b.updatedAt, b.stageChangedAt, b.signing?.latest?.createdAt, b.signing?.signed?.at].filter((x): x is string => Boolean(x)).sort().at(-1)!;

export type MoveCheck =
  | { ok: true; confirm: null | "won" | "lost" | "reopen" | "job" }
  | { ok: false; reason: string };

/** Whether a bid may move to a column, and whether the move needs a confirmation step. */
export function checkMove(b: BoardBid, to: Column): MoveCheck {
  const from = columnOf(b);
  if (from === to) return { ok: false, reason: "The bid is already here." };
  if (b.status === "archived") return { ok: false, reason: "Restore this bid from the Table view before moving it." };
  if (b.signing?.signed && ORDER[to] < ORDER.won)
    return { ok: false, reason: "This bid was e-signed, so it stays Won or later. Move it to Lost / Declined if the job was cancelled." };
  if (b.signing?.state === "awaiting" && ORDER[to] < ORDER.awaiting)
    return { ok: false, reason: "A signing link is still out. Revoke it on the Proposal step before moving this bid back." };
  if (JOB_COLUMNS.includes(to) && !isWonColumn(from))
    return { ok: false, reason: "Mark the bid Approved / Won before scheduling the job." };
  if (to === "won") return { ok: true, confirm: "won" };
  if (to === "lost") return { ok: true, confirm: "lost" };
  if (isWonColumn(from) && !isWonColumn(to)) return { ok: true, confirm: "reopen" };
  if (from === "lost" && isWonColumn(to)) return { ok: true, confirm: "job" };
  return { ok: true, confirm: null };
}

export type NextAction = { label: string; href?: string; move?: Column } | null;

/**
 * One context-aware action per card. With project scheduling switched on, Schedule Now opens the
 * schedule wizard (which moves the bid to Scheduled once a draft schedule is saved).
 */
export function nextAction(b: BoardBid, esign: boolean, scheduling = false): NextAction {
  const col = columnOf(b);
  const edit = `/estimates/${b.id}`, proposal = `/estimates/${b.id}?step=proposal`;
  switch (col) {
    case "draft": return { label: "Continue estimate", href: edit };
    case "ready": return { label: "Send proposal", href: proposal };
    case "sent": return esign && !b.signing?.latest ? { label: "Request signature", href: proposal } : { label: "Review proposal", href: proposal };
    case "awaiting":
      if (b.signing?.state === "expired") return { label: "Resend signing link", href: proposal };
      return { label: "Review customer response", href: proposal };
    case "won": return scheduling ? { label: "Schedule Now", href: `/projects/new?estimate=${b.id}` } : { label: "Schedule Now", move: "scheduled" };
    // With a project schedule, job cards open it: the company calendar for Scheduled, the project otherwise.
    // Start job / Mark completed stay in the card's Move to menu.
    case "scheduled": return scheduling && b.scheduleId ? { label: "View schedule", href: calendarHref({ project: b.scheduleId }) } : { label: "Start job", move: "in_progress" };
    case "in_progress": return scheduling && b.scheduleId ? { label: "View project", href: `/projects/${b.scheduleId}` } : { label: "Mark completed", move: "completed" };
    case "completed":
      if (scheduling && b.scheduleId) return { label: "View completed project", href: `/projects/${b.scheduleId}` };
      return b.signing?.signed ? { label: "View signed proposal", href: `/signed/${b.signing.signed.id}` } : { label: "Review proposal", href: proposal };
    case "lost": return { label: "Review proposal", href: proposal };
  }
}

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------
/**
 * Board filters opened from the Bids dashboard KPI cards (?focus=). Each lists exactly the columns its
 * card counts, so the filtered board always matches the number on the card.
 */
export const FOCUS = {
  active: { label: "Active pipeline", columns: ["ready", "sent", "awaiting"], empty: "No proposals are ready, sent or awaiting a decision." },
  open: { label: "Open bids", columns: ["draft", "ready", "sent", "awaiting"], empty: "No open bids." },
  draft: { label: "Drafts", columns: ["draft"], empty: "No draft bids." },
  sent: { label: "Sent", columns: ["sent"], empty: "No sent proposals." },
  awaiting: { label: "Awaiting signature", columns: ["awaiting"], empty: "No bids awaiting signature." },
  won: { label: "Approved / Won", columns: ["won", "scheduled", "in_progress", "completed"], empty: "No won or approved bids yet." },
  decided: { label: "Won and lost", columns: ["won", "scheduled", "in_progress", "completed", "lost"], empty: "No bids have been won or lost yet." },
} as const satisfies Record<string, { label: string; columns: readonly Column[]; empty: string }>;
export type FocusKey = keyof typeof FOCUS;
export const isFocus = (s: unknown): s is FocusKey => typeof s === "string" && Object.hasOwn(FOCUS, s);

export const RANGES = { "30d": "Last 30 days", month: "This month", "90d": "Last 90 days", year: "Last 12 months", all: "All time", custom: "Custom range" } as const;
export type RangeKey = keyof typeof RANGES;
export const isRange = (s: unknown): s is RangeKey => typeof s === "string" && s in RANGES;
export type Range = { from: Date | null; to: Date | null };

/** [from, to) for a range key. `custom` uses YYYY-MM-DD dates in the viewer's time zone (to is inclusive). */
export function resolveRange(key: RangeKey, now = new Date(), custom?: { from?: string; to?: string }): Range {
  const day = 864e5;
  switch (key) {
    case "30d": return { from: new Date(now.getTime() - 30 * day), to: null };
    case "90d": return { from: new Date(now.getTime() - 90 * day), to: null };
    case "year": return { from: new Date(now.getTime() - 365 * day), to: null };
    case "month": return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    case "all": return { from: null, to: null };
    case "custom": {
      const p = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : null);
      const from = p(custom?.from), to = p(custom?.to);
      return { from, to: to ? new Date(to.getTime() + day) : null };
    }
  }
}
export const inRange = (iso: string | null | undefined, r: Range) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return (!r.from || t >= r.from.getTime()) && (!r.to || t < r.to.getTime());
};

/** Board filter: which date a range applies to. The board always shows each bid's current column. */
export type BoardDateField = "activity" | "created";
export const filterBoard = (bids: BoardBid[], r: Range, field: BoardDateField) =>
  bids.filter((b) => b.status !== "archived" && (!r.from && !r.to ? true : inRange(field === "created" ? b.createdAt : lastActivity(b), r)));

// ---------------------------------------------------------------------------
// Board totals (current snapshot: each bid counted once, in its one column)
// ---------------------------------------------------------------------------
export interface ColumnTotal { count: number; value: number; unpriced: number }
export function columnTotals(bids: BoardBid[]): Record<Column, ColumnTotal> {
  const out = Object.fromEntries(COLUMNS.map((c) => [c, { count: 0, value: 0, unpriced: 0 }])) as Record<Column, ColumnTotal>;
  for (const b of bids) {
    const t = out[columnOf(b)], v = valueOf(b);
    t.count++;
    if (v === null) t.unpriced++; else t.value = round2(t.value + v);
  }
  return out;
}

/** Minimum decided bids before a win rate is shown as a percentage. */
export const MIN_DECIDED = 5;

export interface BoardSummary {
  activeValue: number; openCount: number; awaitingCount: number; wonValue: number; wonCount: number; lostCount: number;
  winRate: number | null; decided: number;
}
/**
 * Top-of-board metrics for the bids currently shown. Active pipeline value counts proposals that exist
 * (Ready, Sent, Awaiting): drafts are counted as open bids but never as value or revenue.
 */
export function boardSummary(bids: BoardBid[]): BoardSummary {
  const t = columnTotals(bids);
  const wonCount = WON_FAMILY.reduce((s, c) => s + t[c].count, 0);
  const decided = wonCount + t.lost.count;
  return {
    activeValue: round2(t.ready.value + t.sent.value + t.awaiting.value),
    openCount: OPEN.reduce((s, c) => s + t[c].count, 0),
    awaitingCount: t.awaiting.count,
    wonValue: round2(WON_FAMILY.reduce((s, c) => s + t[c].value, 0)),
    wonCount, lostCount: t.lost.count, decided,
    winRate: decided >= MIN_DECIDED ? Math.round((wonCount / decided) * 1000) / 10 : null,
  };
}

// ---------------------------------------------------------------------------
// Historical analytics (events within the period, not current stage)
// ---------------------------------------------------------------------------
export interface HistoryRow { estimate_id: string; from_stage: string; to_stage: string; created_at: string; effective_at?: string | null; note?: string | null }
export const HISTORY_STARTED = "2026-11-14";

const SENT_STAGES = new Set(["sent", "pending"]);
const WON_STAGES = new Set(["won", "scheduled", "in_progress", "completed"]);
const at = (h: HistoryRow) => h.effective_at ?? h.created_at;

export interface BidEvents { sentAt: string | null; outcome: { kind: "won" | "lost"; at: string; via: "esign" | "manual" } | null }

/**
 * Events for one bid. Sent = the first move to Sent/Awaiting or the first signing link. Outcome = the
 * bid's latest decision (won by e-signature or manual move, or lost), so a bid is never counted as both.
 */
export function bidEvents(b: BoardBid, history: HistoryRow[]): BidEvents {
  const h = history.filter((x) => x.estimate_id === b.id).sort((a, c) => at(a).localeCompare(at(c)));
  const sentCandidates = [h.find((x) => SENT_STAGES.has(x.to_stage)) && at(h.find((x) => SENT_STAGES.has(x.to_stage))!), b.signing?.latest?.createdAt, b.signing?.signed?.at]
    .filter((x): x is string => Boolean(x)).sort();
  const decisions: { kind: "won" | "lost"; at: string; via: "esign" | "manual" }[] = [];
  for (let i = 0; i < h.length; i++) {
    const x = h[i];
    if (x.to_stage === "lost") decisions.push({ kind: "lost", at: at(x), via: "manual" });
    // Only the move into the won family counts (won -> scheduled is not a second win).
    else if (WON_STAGES.has(x.to_stage) && !WON_STAGES.has(x.from_stage)) decisions.push({ kind: "won", at: at(x), via: "manual" });
  }
  if (b.signing?.signed) decisions.push({ kind: "won", at: b.signing.signed.at, via: "esign" });
  // Bids marked Won before stage history existed: use the backfilled won date.
  if (!decisions.length && WON_STAGES.has(b.stage) && b.wonAt) decisions.push({ kind: "won", at: b.wonAt, via: "manual" });
  decisions.sort((a, c) => a.at.localeCompare(c.at));
  let outcome = decisions.at(-1) ?? null;
  // A signature after a manual win is the same decision: report the signature, dated at the first win.
  if (outcome?.kind === "won") {
    const lastLost = decisions.map((d) => d.kind).lastIndexOf("lost");
    const streak = decisions.slice(lastLost + 1);
    outcome = { kind: "won", at: streak[0].at, via: streak.some((d) => d.via === "esign") ? "esign" : "manual" };
  }
  // A bid that's currently lost but has no history row (shouldn't happen) still counts as lost at its stage change.
  if (!outcome && b.stage === "lost" && b.stageChangedAt) outcome = { kind: "lost", at: b.stageChangedAt, via: "manual" };
  return { sentAt: sentCandidates[0] ?? null, outcome };
}

export interface Analytics {
  created: number; sent: number; awaitingNow: number; won: number; lost: number; decided: number;
  winRate: number | null; wonValue: number; avgWonValue: number | null; wonUnpriced: number;
  avgDaysToWin: number | null; daysSample: number; wonViaEsign: number; wonManual: number;
  /** The bids behind each count (ids), for the Analytics tiles' drilldown drawers. */
  ids: { created: string[]; sent: string[]; awaiting: string[]; won: string[]; lost: string[] };
  wonBids: { id: string; title: string; customer: string; value: number | null; subtotal: number | null; cost: number | null; wonAt: string }[];
}

export function analytics(bids: BoardBid[], history: HistoryRow[], r: Range): Analytics {
  let created = 0, sent = 0, won = 0, lost = 0, wonValue = 0, priced = 0, wonUnpriced = 0, daysTotal = 0, daysSample = 0, esign = 0;
  const wonBids: Analytics["wonBids"] = [];
  const ids: Analytics["ids"] = { created: [], sent: [], awaiting: [], won: [], lost: [] };
  for (const b of bids) {
    if (inRange(b.createdAt, r)) { created++; ids.created.push(b.id); }
    if (columnOf(b) === "awaiting") ids.awaiting.push(b.id);
    const ev = bidEvents(b, history);
    if (inRange(ev.sentAt, r)) { sent++; ids.sent.push(b.id); }
    if (!ev.outcome || !inRange(ev.outcome.at, r)) continue;
    if (ev.outcome.kind === "lost") { lost++; ids.lost.push(b.id); continue; }
    won++; ids.won.push(b.id);
    if (ev.outcome.via === "esign") esign++;
    const v = valueOf(b);
    if (v === null) wonUnpriced++; else { wonValue = round2(wonValue + v); priced++; }
    const days = (new Date(ev.outcome.at).getTime() - new Date(b.createdAt).getTime()) / 864e5;
    if (days >= 0) { daysTotal += days; daysSample++; }
    // Signed bids use the signed version's numbers when it is the latest version; otherwise cost is unknown.
    const sameVersion = !b.signing?.signed || (b.latestVersion && b.latestVersion.number === b.signing.signed.versionNumber);
    wonBids.push({ id: b.id, title: b.title, customer: b.customer, value: v, subtotal: sameVersion ? b.latestVersion?.subtotal ?? null : null, cost: sameVersion ? b.latestVersion?.cost ?? null : null, wonAt: ev.outcome.at });
  }
  const decided = won + lost;
  return {
    created, sent, awaitingNow: ids.awaiting.length, won, lost, decided, ids,
    winRate: decided >= MIN_DECIDED ? Math.round((won / decided) * 1000) / 10 : null,
    wonValue, avgWonValue: priced ? round2(wonValue / priced) : null, wonUnpriced,
    avgDaysToWin: daysSample ? Math.round((daysTotal / daysSample) * 10) / 10 : null, daysSample,
    wonViaEsign: esign, wonManual: won - esign,
    wonBids: wonBids.sort((a, c) => c.wonAt.localeCompare(a.wonAt)),
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
