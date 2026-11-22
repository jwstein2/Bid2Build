import { COLUMNS, columnOf, lastActivity, valueOf, type BoardBid, type Column } from "./board";

/**
 * Pipeline stage search: one shared matcher for every stage card's mini search and the expanded stage view.
 * Read-only and in memory: it runs over the bids the Bids dashboard already loaded (the same rows that make the
 * stage counts and totals), so typing never queries the database and never changes a bid.
 *
 * Every matching bid is returned on its own (two bids for the same customer stay two results), each tagged with
 * the stage it is in right now, computed by the same columnOf() the board uses.
 */

export type MatchField = "customer" | "project" | "number" | "email" | "address";
export const MATCH_LABELS: Record<MatchField, string> = { customer: "Customer", project: "Project", number: "Bid #", email: "Email", address: "Address" };

export interface StageMatch { bid: BoardBid; column: Column; score: number; field: MatchField }
export interface StageSearchResult { local: StageMatch[]; other: StageMatch[] }

export const MAX_QUERY = 100;
export const normaliseQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_QUERY);

/** Higher is better: exact field match 3, a word (or the field) starts with the query 2, contains it 1. */
function scoreText(text: string | null | undefined, q: string): number {
  if (!text) return 0;
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return 0;
  if (t === q) return 3;
  if (t.startsWith(q) || t.split(/[\s,.\-–—/#()]+/).some((w) => w && w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

/** "B-1004", "b-1004", "#B-1004" and "1004" all find bid B-1004; "100" finds it as a partial match. Letters alone never do. */
function scoreNumber(number: string | null | undefined, q: string): number {
  const num = number?.toLowerCase().trim() ?? "";
  const qn = q.replace(/^#/, "");
  if (!num || !/\d/.test(qn)) return 0;
  if (num === qn || num.replace(/\D/g, "") === qn.replace(/\D/g, "") && /^[a-z]{0,3}-?\d+$/.test(qn)) return 30;
  return num.includes(qn) ? 8 : 0;
}

/** Best match for one bid, or null. Customer and project names outrank number, email and address matches. */
export function matchBid(b: BoardBid, q: string): { score: number; field: MatchField } | null {
  if (!q) return null;
  const fields: [MatchField, number][] = [
    ["customer", scoreText(b.customer, q) * 10],
    ["project", scoreText(b.title, q) * 10 - 1],
    ["number", scoreNumber(b.number, q)],
    ["email", scoreText(b.customerEmail, q) * 5],
    ["address", scoreText(b.address, q) * 5],
  ];
  let best: { score: number; field: MatchField } | null = null;
  for (const [field, score] of fields) if (score > 0 && (!best || score > best.score)) best = { score, field };
  return best;
}

const byRank = (a: StageMatch, b: StageMatch) => b.score - a.score || lastActivity(b.bid).localeCompare(lastActivity(a.bid));

/**
 * Searches `bids` for `query`: matches in `column` first (`local`), then matches in every other stage (`other`).
 * Pass the full set of bids the person can see, not the cards on screen, so a bid is always found wherever it is.
 */
export function searchStages(bids: BoardBid[], query: string, column: Column | null): StageSearchResult {
  const q = normaliseQuery(query);
  const out: StageSearchResult = { local: [], other: [] };
  if (!q) return out;
  for (const bid of bids) {
    const m = matchBid(bid, q);
    if (!m) continue;
    const col = columnOf(bid);
    (col === column ? out.local : out.other).push({ bid, column: col, ...m });
  }
  out.local.sort(byRank);
  out.other.sort(byRank);
  return out;
}

export type StageSort = "recent" | "oldest" | "value_desc" | "value_asc";
export const STAGE_SORTS: Record<StageSort, string> = { recent: "Recently updated", oldest: "Oldest first", value_desc: "Highest value", value_asc: "Lowest value" };
export const isStageSort = (s: unknown): s is StageSort => typeof s === "string" && Object.hasOwn(STAGE_SORTS, s);

/** Sorts a copy. Bids without a price go last in both value sorts. */
export function sortStage(bids: BoardBid[], sort: StageSort): BoardBid[] {
  const act = (b: BoardBid) => lastActivity(b);
  const out = [...bids];
  switch (sort) {
    case "recent": return out.sort((a, b) => act(b).localeCompare(act(a)));
    case "oldest": return out.sort((a, b) => act(a).localeCompare(act(b)));
    case "value_desc":
    case "value_asc": {
      const dir = sort === "value_desc" ? -1 : 1;
      return out.sort((a, b) => {
        const va = valueOf(a), vb = valueOf(b);
        if (va === null || vb === null) return va === vb ? act(b).localeCompare(act(a)) : va === null ? 1 : -1;
        return (va - vb) * dir || act(b).localeCompare(act(a));
      });
    }
  }
}

/** Placeholder text for a stage's mini search ("Search drafts…"). */
export const SEARCH_PLACEHOLDER: Record<Column, string> = {
  draft: "Search drafts…", ready: "Search ready bids…", sent: "Search sent bids…", awaiting: "Search awaiting…", won: "Search won bids…",
  scheduled: "Search scheduled…", in_progress: "Search in progress…", completed: "Search completed…", lost: "Search lost bids…",
};

/** Each stage's search text lives in the URL (?s_draft=john) so Back from an opened bid brings it back. */
export const stageQueryParam = (c: Column) => `s_${c}`;
export function readStageQueries(get: (key: string) => string | null | undefined): Partial<Record<Column, string>> {
  const out: Partial<Record<Column, string>> = {};
  for (const c of COLUMNS) { const v = get(stageQueryParam(c)); if (typeof v === "string" && v.trim()) out[c] = v.slice(0, MAX_QUERY); }
  return out;
}
