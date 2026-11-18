/**
 * AI starting-point draft: shared types and the pricing resolver.
 *
 * The AI only drafts WHAT goes in the bid (sections, items, quantities, units). Prices are chosen
 * here, in plain code, in this order:
 *   1. The contractor's own Saved Items (their typed prices and imported supplier price lists).
 *   2. Labor lines: the local BLS median wage × the contractor's labor burden.
 *   3. Retail prices (Home Depot / Lowe's affiliate feeds): coming soon, not live yet.
 *   4. The AI's ballpark cost, only when the contractor keeps "Fill gaps with AI ballpark" on, and
 *      always labelled "AI guess — verify".
 * Every line keeps its source so the panel can show where each number came from. Nothing is added
 * to the bid until the contractor reviews the draft and applies it.
 */
import type { CostType } from "../estimate/types";
import type { SavedItem } from "../library/saved-items";
import { normalizeUnit } from "../pricing/provider";
import { DEFAULT_LABOR_BURDEN, LABOR_TRADE_LABELS, clampBurden, type LaborTrade, type LaborWage } from "./labor-rates";

export const DRAFT_COST_TYPES = ["material", "labor", "labor_material", "equipment", "subcontractor", "permit", "delivery", "other"] as const satisfies readonly CostType[];
export type DraftCostType = (typeof DRAFT_COST_TYPES)[number];

/** One line as the AI drafted it (already validated and clamped by the server). */
export interface DraftLine {
  section: string;
  name: string;
  description: string;
  costType: DraftCostType;
  quantity: number;
  unit: string;
  /** Crew for labor lines; null for everything else. */
  laborTrade: LaborTrade | null;
  /** AI ballpark contractor cost per unit (USD), or null when it gave none. Never used silently. */
  ballparkUnitCost: number | null;
  /** How the quantity was worked out, in a few words ("40 sq ft floor + 10% waste"). */
  basis: string;
}

export interface DraftResponse {
  trade: string;
  lines: DraftLine[];
  assumptions: string[];
  questions: string[];
  labor: { state: string | null; period: string; source: string; wages: LaborWage[] };
  notice?: string;
}

export type PriceSourceKind = "saved" | "labor_rate" | "ai_guess" | "none";

export interface PriceSource {
  kind: PriceSourceKind;
  /** Short badge text: "Your price", "Local labor", "AI guess — verify", "No price". */
  label: string;
  /** One line explaining the number. */
  detail: string;
  savedItemId?: string;
}

export interface PricedLine extends DraftLine {
  /** Internal unit cost as a decimal string ("" = no price; the contractor enters it). */
  unitCost: string;
  source: PriceSource;
}

export interface ResolveOptions {
  savedItems: SavedItem[];
  wages: LaborWage[];
  /** Multiplier on the BLS wage for payroll taxes, workers' comp and insurance. */
  laborBurden?: number;
  /** Use the AI ballpark for lines nothing else priced. */
  useBallpark: boolean;
  trade?: string;
}

const STOP = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "on", "with", "per", "x", "by", "or", "new", "install", "installation", "labor", "material", "materials", "supply"]);

/** Lowercase word set without filler words or simple plurals ("Tiles" and "tile" match). */
export function nameTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").split(" ")) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (!w || STOP.has(w)) continue;
    out.add(w.length > 3 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  }
  return out;
}

/** Dice similarity of two item names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const x = nameTokens(a), y = nameTokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return (2 * both) / (x.size + y.size);
}

export const MATCH_THRESHOLD = 0.6;

const isLaborish = (t: CostType) => t === "labor" || t === "labor_material";

/** Best Saved Item for a line: same unit, compatible cost type, similar name, with a price. */
export function matchSavedItem(line: DraftLine, items: SavedItem[], trade?: string): SavedItem | null {
  const unit = normalizeUnit(line.unit);
  let best: SavedItem | null = null;
  let bestScore = 0;
  for (const it of items) {
    if (!it.unitCost || !(Number(it.unitCost) >= 0)) continue;
    if (normalizeUnit(it.unit) !== unit) continue;
    if (isLaborish(line.costType) !== isLaborish(it.costType)) continue;
    const exact = it.name.trim().toLowerCase() === line.name.trim().toLowerCase();
    let score = exact ? 1.2 : nameSimilarity(line.name, it.name);
    if (score > 0 && trade && it.trade === trade) score += 0.05;
    if (score > bestScore) { best = it; bestScore = score; }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function resolveDraft(lines: DraftLine[], opts: ResolveOptions): PricedLine[] {
  const burden = clampBurden(opts.laborBurden ?? DEFAULT_LABOR_BURDEN);
  const wages = new Map(opts.wages.map((w) => [w.trade, w]));
  return lines.map((line): PricedLine => {
    const saved = matchSavedItem(line, opts.savedItems, opts.trade);
    if (saved) {
      const from = saved.supplierName ? ` (from your ${saved.supplierName} price list)` : "";
      return { ...line, unitCost: saved.unitCost, source: { kind: "saved", label: "Your price", detail: `Saved Item “${saved.name}”${from}`, savedItemId: saved.id } };
    }
    if (line.costType === "labor" && normalizeUnit(line.unit) === "hour" && line.laborTrade) {
      const w = wages.get(line.laborTrade);
      if (w) {
        const where = w.area === "US" ? "US" : w.area;
        return {
          ...line,
          unitCost: money(w.wage * burden),
          source: { kind: "labor_rate", label: "Local labor", detail: `${LABOR_TRADE_LABELS[w.trade].label} median wage in ${where} $${w.wage.toFixed(2)}/hr (BLS) × ${burden} burden. Hours are an AI estimate.` },
        };
      }
    }
    if (opts.useBallpark && line.ballparkUnitCost !== null && line.ballparkUnitCost > 0) {
      return { ...line, unitCost: money(line.ballparkUnitCost), source: { kind: "ai_guess", label: "AI guess — verify", detail: "Ballpark from the AI, not a real quote. Check it before you send the bid." } };
    }
    return { ...line, unitCost: "", source: { kind: "none", label: "No price", detail: "Enter your cost, or save it to Saved Items so future drafts use it." } };
  });
}

export function sourceCounts(lines: PricedLine[]): Record<PriceSourceKind, number> {
  const c: Record<PriceSourceKind, number> = { saved: 0, labor_rate: 0, ai_guess: 0, none: 0 };
  for (const l of lines) c[l.source.kind]++;
  return c;
}
