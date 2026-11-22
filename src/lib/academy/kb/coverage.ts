/**
 * State × trade coverage (admin view). Trades share codebooks: a roofer and a framer both work under the residential
 * and building codes, so a trade's coverage in a state is the best status of the code categories it relies on.
 * Trades with no building-code category (cleaning, pressure washing...) are covered by federal safety rules and
 * licensing only, and are labeled that way instead of being counted as gaps.
 */
import type { CodeCategory } from "./answer";

export type CellStatus = "searchable" | "reference" | "pending" | "none";
export const CELL_LABEL: Record<CellStatus, string> = { searchable: "Verified and searchable", reference: "Official reference available", pending: "Pending verification", none: "Not on file" };

export const TRADE_CATEGORIES: Record<string, CodeCategory[]> = {
  roofing: ["residential", "building", "energy"], siding: ["residential", "building"], decks: ["residential"], concrete: ["residential", "building"],
  kitchens: ["residential", "plumbing", "electrical"], bathrooms: ["residential", "plumbing", "electrical"], "interior-remodeling": ["residential", "existing"],
  "exterior-remodeling": ["residential", "existing"], drywall: ["residential", "building"], painting: [], electrical: ["electrical"], plumbing: ["plumbing"],
  hvac: ["mechanical", "energy"], flooring: ["residential"], tile: ["residential"], framing: ["residential", "building"], "finish-carpentry": ["residential"],
  "cabinets-countertops": ["residential"], "windows-doors": ["residential", "energy"], insulation: ["energy", "residential"], gutters: ["residential"],
  fencing: [], landscaping: [], "tree-removal": [], "tree-trimming": [], "pressure-washing": [], "soft-washing": [], cleaning: [], "pest-control": [],
  excavation: ["building"], foundations: ["residential", "building"], masonry: ["residential", "building"], "asphalt-paving": [], demolition: ["building", "fire"],
  basements: ["residential", "existing"], additions: ["residential", "building", "energy"], garages: ["residential"], "pole-barns": ["building"],
  "commercial-remodeling": ["building", "existing", "fire"], "general-contracting": ["residential", "building", "electrical", "plumbing", "mechanical", "energy"],
  handyman: ["residential"], other: [],
};

const RANK: Record<CellStatus, number> = { searchable: 3, reference: 2, pending: 1, none: 0 };

/** Best status among a trade's categories; null when the trade relies on no building-code category. */
export function tradeStatus(trade: string, cats: Partial<Record<string, { status: CellStatus }>>): CellStatus | null {
  const need = TRADE_CATEGORIES[trade];
  if (!need || need.length === 0) return null;
  let best: CellStatus = "none";
  for (const c of need) {
    const s = cats[c]?.status ?? "none";
    if (RANK[s] > RANK[best]) best = s;
  }
  return best;
}

export interface CoverageRunState {
  state: string; name: string; coverage: string; adoptions_verified: number; adoptions_pending: number; local_records: number;
  categories: Record<string, { status: CellStatus; codes: { name: string; edition: string; effective: string | null; status: string; url: string | null }[] }>;
  searches: { q: string; outcome: "answer" | "reference" | "no_match"; citation: string | null; status: string | null; lead_family: string | null; lead_category: string | null; results: number }[];
}
