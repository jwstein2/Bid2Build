import { CALCULATORS, SHAPES } from "./registry";
import type { CalcDef, CalcInput, CalcPreset, CalcRecord, CalcSection } from "./types";

/**
 * Which calculators a line item gets. Driven by the item's UNIT first (an hourly line never gets
 * an area calculator), then refined by trade and item name so the right calculator is first and
 * starts with sensible shapes. Items priced by the hour, day, lump sum, ton or load get only the
 * labor calculator or nothing at all.
 */
interface Rule {
  units: string[];
  name?: RegExp;
  trades?: string[];
  presets: CalcPreset[];
}

const AREA_UNITS = ["square foot", "square yard", "square"];
const PACKAGE_UNITS = ["gallon", "box", "bundle", "roll", "sheet", "bag"];
const WALL_TRADES = ["siding", "painting", "soft-washing", "exterior-remodeling", "insulation", "drywall"];

const out = (unit: string): string | undefined => ({ "square foot": "sf", "square yard": "sy", square: "sq" } as Record<string, string>)[unit];

const RULES: Rule[] = [
  // Stairs: tread coverage, riser/tread counts, stringers.
  { units: ["square foot"], name: /\bstair|tread/i, presets: [{ calc: "stairs", label: "Stair tread area", output: "tread_area" }] },
  { units: ["each", "piece"], name: /stringer/i, presets: [{ calc: "stairs", label: "Stair stringers", output: "stringers" }] },
  { units: ["each", "piece"], name: /\briser/i, presets: [{ calc: "stairs", label: "Stair risers", output: "risers" }] },
  { units: ["each", "piece"], name: /\bstair|tread/i, presets: [{ calc: "stairs", label: "Stair treads", output: "treads" }] },

  // Trim bought by the board or length.
  { units: ["each"], name: /fascia|trim board|rim board|j-?channel|drip edge|baseboard|casing/i, presets: [{ calc: "perimeter", label: "Fascia & trim boards (perimeter ÷ board length)", output: "each" }] },
  { units: ["each"], name: /rail(ing)? (section|panel)|top rail|handrail/i, presets: [{ calc: "linear", label: "Railing lengths", output: "each" }] },

  // Decking material.
  { units: ["each", "piece", "linear foot"], name: /deck(ing)? ?boards?|decking\b(?! install)/i, presets: [{ calc: "boards", label: "Decking boards" }] },

  // Roofing surfaces (and soft-wash roof cleaning).
  { units: AREA_UNITS, name: /roof|shingle|underlayment|tear-?off|re-?roof|felt|membrane/i, presets: [{ calc: "roof", label: "Roof area" }] },
  { units: AREA_UNITS, trades: ["roofing"], presets: [{ calc: "roof", label: "Roof area" }] },

  // Edges & trim (roof edges, siding accessories, fascia, railing, fence).
  { units: ["linear foot", "piece"], name: /ridge|hip|valley|eave|rake|drip edge/i, presets: [{ calc: "linear", label: "Ridge & edge lengths" }] },
  { units: ["linear foot", "piece", "bundle"], name: /starter/i, presets: [{ calc: "perimeter", label: "Starter strip (building perimeter)" }] },
  { units: ["linear foot", "piece"], name: /j-?channel|casing|window trim|door trim|opening trim|brick ?mold/i, presets: [{ calc: "linear", label: "Trim around openings", shape: "opening_trim" }] },
  { units: ["linear foot", "piece"], name: /fascia|soffit|gutter|baseboard|crown|perimeter|form board|edging|border|expansion joint|sill plate|base trim/i, presets: [{ calc: "perimeter", label: "Perimeter" }] },
  { units: ["linear foot", "piece"], name: /corner/i, presets: [{ calc: "linear", label: "Corner lengths (height × corners)" }] },
  { units: ["linear foot"], name: /rail|fence|cabinet|countertop/i, presets: [{ calc: "linear", label: "Linear footage" }] },

  // Kitchens & baths.
  { units: AREA_UNITS, name: /countertop|counter top|vanity top/i, presets: [{ calc: "area", label: "Countertop area" }] },
  { units: AREA_UNITS, name: /backsplash/i, presets: [{ calc: "area", label: "Backsplash area (length × height)", shape: "wall" }] },
  { units: AREA_UNITS, name: /shower|tub surround|waterproof|wall tile|tile wall/i, presets: [{ calc: "area", label: "Shower wall area", shape: "wall", extraShapes: [{ shape: "opening", deduct: true }] }] },
  { units: AREA_UNITS, name: /floor|tile|carpet|lvp|vinyl plank|hardwood|underlayment pad/i, presets: [{ calc: "area", label: "Floor area" }] },

  // Walls: siding, paint, soft washing, house wrap.
  {
    units: AREA_UNITS, name: /siding|wall|house wrap|wrap|paint|soft ?wash|exterior|stucco|brick|veneer|insulation|drywall|primer/i,
    presets: [{ calc: "area", label: "Wall area", shape: "wall", extraShapes: [{ shape: "triangle" }, { shape: "opening", deduct: true }] }],
  },
  {
    units: AREA_UNITS, trades: WALL_TRADES,
    presets: [{ calc: "area", label: "Wall area", shape: "wall", extraShapes: [{ shape: "triangle" }, { shape: "opening", deduct: true }] }],
  },
  // Concrete & bulk material.
  { units: ["cubic yard"], name: /footing|pier|caisson|post hole/i, presets: [{ calc: "volume", label: "Footing volume", shape: "footing" }] },
  { units: ["cubic yard"], name: /excavat|dig|trench|haul/i, presets: [{ calc: "volume", label: "Excavation volume", shape: "box" }] },
  { units: ["cubic yard"], presets: [{ calc: "volume", label: "Volume", shape: "slab" }] },

  // Generic by unit.
  { units: AREA_UNITS, presets: [{ calc: "area", label: "Area" }] },
  { units: ["linear foot"], presets: [{ calc: "linear", label: "Linear footage" }, { calc: "perimeter", label: "Perimeter" }] },
  { units: ["piece"], presets: [{ calc: "linear", label: "Pieces from linear footage", output: "pcs" }] },
  { units: PACKAGE_UNITS, name: /tile|grout|thinset|mortar/i, presets: [{ calc: "coverage", label: "Tile & setting material coverage" }] },
  { units: PACKAGE_UNITS, presets: [{ calc: "coverage", label: "Material coverage" }] },
  { units: ["hour", "day"], presets: [{ calc: "labor", label: "Labor hours from production rate" }] },
];

/** Secondary calculators offered after the primary ones, by unit. */
const EXTRAS: Rule[] = [
  { units: AREA_UNITS, presets: [{ calc: "convert", label: "Unit conversion" }] },
  { units: ["linear foot"], presets: [{ calc: "convert", label: "Unit conversion" }] },
  { units: ["cubic yard"], presets: [{ calc: "convert", label: "Unit conversion" }] },
  { units: ["linear foot", "piece"], presets: [{ calc: "perimeter", label: "Perimeter" }] },
];

function matches(rule: Rule, unit: string, name: string, trades: string[]): boolean {
  if (!rule.units.includes(unit)) return false;
  if (rule.name && !rule.name.test(name)) return false;
  if (rule.trades && !rule.trades.some((t) => trades.includes(t))) return false;
  return true;
}

/** Ordered, de-duplicated calculators for a line item. Empty when no calculator fits. */
export function calculatorsFor(item: { name: string; unit: string }, trades: string[]): CalcPreset[] {
  const seen = new Set<string>();
  const result: CalcPreset[] = [];
  const push = (p: CalcPreset) => {
    if (seen.has(p.calc)) return;
    const def = CALCULATORS[p.calc];
    // Never offer a calculator that cannot produce this item's unit.
    const output = p.output ?? defaultOutput(def, item.unit);
    if (!output) return;
    seen.add(p.calc);
    result.push({ ...p, output });
  };
  for (const r of RULES) if (matches(r, item.unit, item.name, trades)) { r.presets.forEach(push); break; }
  // A second, more generic pass so e.g. siding "square" items also get plain Area.
  for (const r of RULES) if (!r.name && !r.trades && matches(r, item.unit, item.name, trades)) r.presets.forEach(push);
  for (const r of EXTRAS) if (matches(r, item.unit, item.name, trades)) r.presets.forEach(push);
  return result;
}

/** The calculator output matching a line item's unit, if any. */
export function defaultOutput(def: CalcDef, unit: string): string | undefined {
  return (def.outputs.find((o) => o.unit === unit) ?? (def.id === "area" || def.id === "roof" ? def.outputs.find((o) => o.id === out(unit)) : undefined))?.id;
}

let seq = 0;
const sectionId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newSection(shapeId: string, deduct = false): CalcSection {
  const shape = SHAPES[shapeId];
  const values: Record<string, string> = {};
  for (const f of shape?.fields ?? []) if (f.initial !== undefined) values[f.key] = f.initial;
  return { id: sectionId(), shape: shapeId, deduct: deduct || undefined, values };
}

/** A fresh calculator input from a preset: first shape(s) and option defaults (never prices). */
export function newInput(preset: CalcPreset): CalcInput {
  const def = CALCULATORS[preset.calc];
  const options: Record<string, string> = {};
  for (const f of def.options) if (f.initial !== undefined) options[f.key] = f.initial;
  Object.assign(options, preset.options ?? {});
  const sections: CalcSection[] = [];
  if (def.shapes.length) {
    const first = preset.shape && def.shapes.some((s) => s.id === preset.shape) ? preset.shape : def.shapes[0].id;
    sections.push(newSection(first));
    for (const x of preset.extraShapes ?? []) if (def.shapes.some((s) => s.id === x.shape)) sections.push(newSection(x.shape, x.deduct));
  }
  return { sections, options };
}

/** Is the saved calculation still what the line item shows? False once the quantity was edited by hand. */
export function recordMatchesItem(record: CalcRecord | undefined, item: { quantity: string; unit: string }): boolean {
  if (!record) return false;
  return record.unit === item.unit && Number(record.result) === Number(item.quantity);
}
