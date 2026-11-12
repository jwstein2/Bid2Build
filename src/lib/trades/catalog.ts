import type { ChargeTreatment, CostType } from "../estimate/types";
import { TRADE_SEED_VERSION, tradeSeeds, type TradeSeed } from "./data";

export interface TemplateItem {
  name: string;
  unit: string;
  costType: CostType;
  treatment: ChargeTreatment;
}

export interface TradeTemplate {
  trade: string;
  version: number;
  groups: { name: string; items: TemplateItem[] }[];
  examples: TemplateItem[];
}

export interface Trade extends Omit<TradeSeed, "groups" | "examples"> {
  template: TradeTemplate;
}

export function parseTemplateItem(spec: string): TemplateItem {
  const [name, unit = "each", costType = "material", pass] = spec.split("|");
  return { name, unit, costType: costType as CostType, treatment: pass === "pass" ? "pass_through" : "marked_up" };
}

function toTrade(seed: TradeSeed): Trade {
  const { groups, examples, ...rest } = seed;
  return {
    ...rest,
    template: {
      trade: seed.slug,
      version: TRADE_SEED_VERSION,
      groups: groups.map((g) => ({ name: g.name, items: g.items.map(parseTemplateItem) })),
      examples: examples.map(parseTemplateItem),
    },
  };
}

export const trades: Trade[] = tradeSeeds.map(toTrade);
const bySlug = new Map(trades.map((t) => [t.slug, t]));

export const featuredTrades = trades.filter((t) => t.featured);
export const getTrade = (slug: string): Trade | undefined => bySlug.get(slug);
export const tradeName = (slug: string): string => bySlug.get(slug)?.name ?? slug;

export const UNITS = [
  "each", "linear foot", "square foot", "square yard", "cubic yard", "hour", "day", "week",
  "lump sum", "ton", "gallon", "sheet", "box", "bundle", "square", "roll", "bag", "piece", "load",
] as const;

export const UNIT_ABBR: Record<string, string> = {
  each: "ea", "linear foot": "LF", "square foot": "SF", "square yard": "SY", "cubic yard": "CY",
  hour: "hr", day: "day", week: "wk", "lump sum": "LS", ton: "ton", gallon: "gal", sheet: "sht",
  box: "box", bundle: "bdl", square: "sq", roll: "roll", bag: "bag", piece: "pc", load: "load",
};

export const COST_TYPES: { value: CostType; label: string }[] = [
  { value: "material", label: "Material" },
  { value: "labor", label: "Labor" },
  { value: "equipment", label: "Equipment" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "overhead", label: "Overhead" },
  { value: "contingency", label: "Contingency" },
  { value: "permit", label: "Permit / fee" },
  { value: "delivery", label: "Delivery" },
  { value: "labor_burden", label: "Labor burden" },
  { value: "other", label: "Other" },
];
