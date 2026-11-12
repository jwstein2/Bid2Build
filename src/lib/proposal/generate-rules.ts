/**
 * Deterministic, offline scope and exclusion drafting, plus the guards applied to AI output.
 * Runs in the browser and on the server, so the app keeps working with no AI service at all.
 *
 * Rules of the road (from the product brief):
 *  - Use only what the estimate says. Never invent dimensions, permits, warranties, grades,
 *    demolition, disposal, schedules or code-compliance claims.
 *  - Never exclude work that the estimate includes. When it's unclear, flag for review.
 */
import { newId, type ExclusionItem, type GenerationInput, type GenGroup, type GenItem, type WritingStyle } from "./text-sections";

export const RULES_SCOPE_VERSION = "rules:scope-v1";
export const RULES_EXCLUSIONS_VERSION = "rules:exclusions-v1";

/* ----------------------------------------------- Scope ----------------------------------------- */

const UNIT_WORDS: Record<string, [string, string]> = {
  "square foot": ["sq. ft.", "sq. ft."], "linear foot": ["linear ft.", "linear ft."], "square yard": ["sq. yd.", "sq. yd."],
  "cubic yard": ["cu. yd.", "cu. yd."], square: ["roofing square", "roofing squares"], ton: ["ton", "tons"], gallon: ["gallon", "gallons"],
  sheet: ["sheet", "sheets"], box: ["box", "boxes"], bundle: ["bundle", "bundles"], roll: ["roll", "rolls"], bag: ["bag", "bags"],
  piece: ["piece", "pieces"], load: ["load", "loads"],
};
/** Units where the quantity doesn't describe the work to a customer (time, lump sums). */
const SILENT_UNITS = new Set(["lump sum", "hour", "day", "week"]);

function fmtQty(q: string): string | null {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number.isInteger(n) ? n.toLocaleString("en-US") : String(Number(n.toFixed(2)));
}

/** "400 sq. ft. Trex composite decking", "4 concrete footings", "Installation labor". */
export function itemPhrase(i: GenItem): string {
  const name = i.name.trim();
  const q = fmtQty(i.quantity);
  if (!q || SILENT_UNITS.has(i.unit) || i.kind === "labor" || i.kind === "permit" || i.kind === "overhead" || i.kind === "contingency" || i.kind === "labor_burden") return name;
  const w = UNIT_WORDS[i.unit];
  if (w) return `${q} ${Number(i.quantity) === 1 ? w[0] : w[1]} ${name}`;
  if (i.unit === "each" && Number(i.quantity) > 1) return `${name} (${q})`;
  return name;
}

/** Items that are internal bookkeeping rather than work the customer would recognize. */
const isBookkeeping = (i: GenItem) => i.kind === "overhead" || i.kind === "contingency" || i.kind === "labor_burden";

function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Names keep the contractor's capitalization: lowercasing would break brand names like "Trex". */
const asWritten = (s: string) => s;

function projectNoun(input: GenerationInput): string {
  if (input.projectTitle) return input.projectTitle;
  if (input.trades.length) return `${listJoin(input.trades)} project`;
  return "this project";
}

function workItems(g: GenGroup) {
  return g.items.filter((i) => !isBookkeeping(i));
}

export function ruleScope(input: GenerationInput, style: WritingStyle = input.style): string {
  const groups = input.groups.map((g) => ({ ...g, items: workItems(g) })).filter((g) => g.items.length);
  if (!groups.length) return "";
  const all = groups.flatMap((g) => g.items);
  const hasLabor = all.some((i) => i.kind === "labor" || i.kind === "subcontractor");
  const hasMaterial = all.some((i) => i.kind === "material" || i.kind === "equipment");
  const furnish = hasLabor && hasMaterial ? "Furnish the labor and materials" : hasLabor ? "Provide the labor" : "Furnish the materials";
  const noun = projectNoun(input);

  if (style === "simple") {
    const phrases = all.slice(0, 8).map((i) => asWritten(itemPhrase(i)));
    const more = all.length > 8 ? ", plus the other items listed in this estimate" : "";
    return `This proposal covers ${asWritten(noun)}. The work includes ${listJoin(phrases)}${more}.`;
  }

  if (style === "detailed") {
    const out = [`${furnish} for ${asWritten(noun)} as detailed in this estimate. The work is organized as follows:`];
    for (const g of groups) {
      out.push("", g.name.toUpperCase());
      if (g.description) out.push(g.description);
      for (const i of g.items) out.push(`• ${itemPhrase(i)}${i.description ? ` (${i.description})` : ""}`);
    }
    return out.join("\n");
  }

  // professional (default)
  const out = [`${furnish} for ${asWritten(noun)} as detailed in this estimate. Work includes:`];
  for (const g of groups) {
    const phrases = g.items.map((i) => asWritten(itemPhrase(i)));
    out.push(groups.length === 1 && g.name.toLowerCase() === "work" ? `• ${listJoin(phrases)}.` : `• ${g.name}: ${listJoin(phrases)}.`);
  }
  return out.join("\n");
}

/* --------------------------------------------- Exclusions -------------------------------------- */

interface Candidate {
  category: string;
  title: string;
  text: Record<WritingStyle, string>;
  /** Words that mean the bid includes this kind of work. */
  keywords: RegExp;
  /** Trade slugs/names this applies to; "*" = all. */
  trades: "*" | string[];
  /** Trades for which this exclusion would be self-contradictory (their core work). */
  notFor?: string[];
  /** Cost types that count as "included". */
  kinds?: string[];
}

const OUTDOOR = ["decks", "fencing", "concrete", "landscaping", "excavation", "foundations", "masonry", "asphalt-paving", "roofing", "siding", "gutters", "exterior-remodeling", "additions", "garages", "pole-barns", "demolition"];
const INTERIOR = ["kitchens", "bathrooms", "interior-remodeling", "drywall", "painting", "flooring", "tile", "finish-carpentry", "cabinets-countertops", "basements", "insulation", "commercial-remodeling", "windows-doors", "handyman"];
const STRUCTURAL = ["decks", "additions", "framing", "foundations", "garages", "pole-barns", "basements", "concrete", "exterior-remodeling", "general-contracting"];

const CANDIDATES: Candidate[] = [
  {
    category: "permits", title: "Permits & Inspections", trades: "*", kinds: ["permit"],
    keywords: /\bpermit|inspection fee|inspections?\b/i,
    text: {
      simple: "Permit and inspection fees are not included unless listed in the estimate.",
      professional: "Permit fees and municipal inspection costs are excluded unless specifically included in the estimate.",
      detailed: "Building permit fees, plan review fees, and municipal inspection costs are excluded unless they are specifically listed as a line item in this estimate.",
    },
  },
  {
    category: "electrical", title: "Electrical", trades: [...OUTDOOR, ...INTERIOR, "framing", "plumbing", "hvac", "general-contracting"], notFor: ["electrical"],
    keywords: /electric|wiring|\bwires?\b|outlet|receptacle|circuit|breaker|\bpanels?\b|\blight(s|ing)?\b|fixture|switch|conduit|gfci/i,
    text: {
      simple: "Electrical work is not included unless listed in the estimate.",
      professional: "Electrical wiring, lighting installation, and additional electrical services are excluded unless otherwise specified.",
      detailed: "Electrical wiring, new circuits, panel work, lighting, and fixture installation are excluded unless specifically listed in this estimate. Any electrical work will be quoted separately.",
    },
  },
  {
    category: "plumbing", title: "Plumbing", trades: ["kitchens", "bathrooms", "interior-remodeling", "basements", "additions", "commercial-remodeling", "tile", "cabinets-countertops", "general-contracting", "handyman"], notFor: ["plumbing"],
    keywords: /plumb|pipe|piping|faucet|drain|water heater|toilet|sink|supply line|shut-?off|valve|disposal unit/i,
    text: {
      simple: "Plumbing work is not included unless listed in the estimate.",
      professional: "Plumbing modifications, fixture connections, and relocation of water or drain lines are excluded unless otherwise specified.",
      detailed: "Plumbing work, including new or relocated supply and drain lines, fixture connections, and water heater work, is excluded unless specifically listed in this estimate.",
    },
  },
  {
    category: "hvac", title: "Heating & Cooling", trades: ["additions", "basements", "interior-remodeling", "commercial-remodeling", "kitchens", "bathrooms", "insulation", "general-contracting"], notFor: ["hvac"],
    keywords: /hvac|duct|furnace|air condition|\bac\b|heat pump|vent fan|exhaust fan|register|mini-?split/i,
    text: {
      simple: "Heating and cooling work is not included unless listed in the estimate.",
      professional: "HVAC modifications, ductwork, and equipment are excluded unless otherwise specified.",
      detailed: "Heating, ventilation, and air-conditioning work, including ductwork extensions, registers, and equipment, is excluded unless specifically listed in this estimate.",
    },
  },
  {
    category: "landscaping", title: "Landscaping", trades: OUTDOOR, notFor: ["landscaping"],
    keywords: /landscap|\bsod\b|irrigation|sprinkler|seed|mulch|plant(ing)?s?\b|lawn|topsoil|grading|restor/i,
    text: {
      simple: "Landscaping repair or restoration is not included unless listed in the estimate.",
      professional: "Restoration of landscaping, irrigation systems, sod, and surrounding property is excluded unless listed in the Scope of Work.",
      detailed: "Restoration of lawns, plantings, irrigation systems, and other landscaping disturbed by construction access is excluded unless it is listed in the Scope of Work or the estimate.",
    },
  },
  {
    category: "demolition", title: "Demolition & Removal", trades: "*", notFor: ["demolition"],
    keywords: /demo(lition)?\b|tear[- ]?(off|out)|remov(e|al)|rip[- ]?out|strip/i,
    text: {
      simple: "Removing existing materials or structures is not included unless listed in the estimate.",
      professional: "Demolition or removal of existing structures and materials is excluded unless listed in the estimate.",
      detailed: "Demolition, tear-out, or removal of existing structures, finishes, or materials is excluded unless it is specifically listed in this estimate.",
    },
  },
  {
    category: "disposal", title: "Debris Disposal", trades: "*",
    keywords: /dispos|haul|dumpster|debris|dump fee|roll-?off|trash|clean-?up/i,
    text: {
      simple: "Hauling away debris is not included unless listed in the estimate.",
      professional: "Debris haul-away, dumpster rental, and disposal fees are excluded unless listed in the estimate.",
      detailed: "Haul-away of construction debris, dumpster rental, and landfill or disposal fees are excluded unless they are specifically listed in this estimate.",
    },
  },
  {
    category: "finishing", title: "Painting & Finishing", trades: ["decks", "fencing", "drywall", "finish-carpentry", "siding", "windows-doors", "framing", "additions", "basements", "interior-remodeling", "exterior-remodeling", "garages"], notFor: ["painting"],
    keywords: /paint|stain|seal(er|ant|ing)?\b|primer|finish coat|varnish|texture/i,
    text: {
      simple: "Painting, staining, or sealing is not included unless listed in the estimate.",
      professional: "Painting, staining, sealing, or other finish coatings are excluded unless listed in the estimate.",
      detailed: "Painting, priming, staining, sealing, and other finish coatings are excluded unless they are specifically listed in this estimate.",
    },
  },
  {
    category: "engineering", title: "Engineering & Drawings", trades: STRUCTURAL,
    keywords: /engineer|drawing|blueprint|survey|stamped|architect|plans?\b/i,
    text: {
      simple: "Engineering, drawings, and surveys are not included unless listed in the estimate.",
      professional: "Engineering, architectural drawings, and property surveys are excluded unless listed in the estimate.",
      detailed: "Structural engineering, architectural or permit drawings, soil testing, and property or boundary surveys are excluded unless they are specifically listed in this estimate.",
    },
  },
  {
    category: "appliances", title: "Appliances & Owner-Selected Fixtures", trades: ["kitchens", "bathrooms", "cabinets-countertops", "interior-remodeling"],
    keywords: /appliance|refrigerator|fridge|range\b|oven|cooktop|dishwasher|microwave|hood|washer|dryer/i,
    text: {
      simple: "Appliances are not included unless listed in the estimate.",
      professional: "Purchase of appliances and owner-selected fixtures is excluded unless listed in the estimate.",
      detailed: "Purchase of appliances, decorative fixtures, and other owner-selected items is excluded unless they are specifically listed in this estimate.",
    },
  },
  {
    category: "contents", title: "Moving Contents", trades: ["flooring", "painting", "tile", "interior-remodeling", "kitchens", "bathrooms", "drywall", "basements", "insulation"],
    keywords: /move (furniture|contents)|furniture|contents|pack(ing)?\b/i,
    text: {
      simple: "Moving furniture and belongings is not included.",
      professional: "Moving furniture, appliances, and personal belongings out of the work area is excluded unless listed in the estimate.",
      detailed: "Moving and protecting furniture, appliances, and personal belongings in the work area is the owner's responsibility unless it is specifically listed in this estimate.",
    },
  },
  {
    category: "hazardous", title: "Hazardous Materials", trades: [...INTERIOR, "roofing", "siding", "demolition", "exterior-remodeling", "general-contracting"],
    keywords: /asbestos|lead|mold|abatement|hazard/i,
    text: {
      simple: "Testing for or removing asbestos, lead paint, or mold is not included.",
      professional: "Testing, abatement, or removal of asbestos, lead-based paint, mold, or other hazardous materials is excluded.",
      detailed: "Testing for, abatement of, or removal of asbestos, lead-based paint, mold, or other hazardous materials is excluded. If such materials are discovered, work in the affected area may pause until they are addressed by a qualified specialist.",
    },
  },
  {
    category: "unforeseen", title: "Unforeseen Conditions", trades: "*", keywords: /$^/,
    text: {
      simple: "Hidden problems found during the work may need extra work, which we'll discuss with you first.",
      professional: "Hidden structural damage, unsuitable soil conditions, or other concealed issues discovered during construction may require additional work and written approval.",
      detailed: "Concealed conditions discovered during construction, such as hidden structural damage, rot, unsuitable soil, or code deficiencies in existing work, are not included. Any additional work they require will be documented and approved in writing before it proceeds.",
    },
  },
  {
    category: "change_orders", title: "Additional Work", trades: "*", keywords: /$^/,
    text: {
      simple: "Work outside this proposal needs a written change order.",
      professional: "Any work requested outside the approved Scope of Work may require a separate written change order.",
      detailed: "Any work requested outside the approved Scope of Work, including changes to materials, dimensions, or layout, will be documented in a written change order with any price adjustment before the work proceeds.",
    },
  },
];

export const EXCLUSION_CATEGORIES: Record<string, string> = Object.fromEntries([...CANDIDATES.map((c) => [c.category, c.title]), ["custom", "Custom"]]);

function tradeKeys(input: GenerationInput): string[] {
  return input.tradeSlugs ?? [];
}

function applies(c: Candidate, trades: string[]): boolean {
  if (c.notFor && trades.some((t) => c.notFor!.includes(t))) return false;
  if (c.trades === "*") return true;
  if (!trades.length || trades.every((t) => t === "other")) return ["permits", "unforeseen", "change_orders"].includes(c.category);
  return trades.some((t) => (c.trades as string[]).includes(t));
}

export interface Coverage {
  /** The bid's line items or sections include this kind of work. */
  included: boolean;
  /** Only the scope text or notes mention it: ambiguous. */
  mentioned: boolean;
}

/** Does the estimate include (or mention) the work this exclusion category would exclude? */
export function coverage(category: string, input: GenerationInput): Coverage {
  const c = CANDIDATES.find((x) => x.category === category);
  if (!c) return { included: false, mentioned: false };
  const bidText = input.groups.flatMap((g) => [g.name, g.description ?? "", ...g.items.flatMap((i) => [i.name, i.description ?? ""])]).join("\n");
  const kindHit = Boolean(c.kinds && input.groups.some((g) => g.items.some((i) => c.kinds!.includes(i.kind))));
  const trades = tradeKeys(input);
  const coreTrade = Boolean(c.notFor && trades.some((t) => c.notFor!.includes(t)));
  const included = kindHit || coreTrade || c.keywords.test(bidText) || (c.keywords.source !== "$^" && c.keywords.test(input.projectTitle));
  const mentioned = !included && c.keywords.source !== "$^" && c.keywords.test(`${input.scope ?? ""}\n${input.notes ?? ""}`);
  return { included, mentioned };
}

/** Map free-form AI categories onto our standard keys. */
export function canonicalCategory(raw: string): string {
  const k = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (CANDIDATES.some((c) => c.category.replace(/_/g, "") === k)) return CANDIDATES.find((c) => c.category.replace(/_/g, "") === k)!.category;
  const map: [RegExp, string][] = [
    [/permit|inspect/, "permits"], [/electric/, "electrical"], [/plumb/, "plumbing"], [/hvac|heat|cool|mechanical/, "hvac"],
    [/landscap|yard|site/, "landscaping"], [/demo|remov/, "demolition"], [/dispos|debris|haul/, "disposal"], [/paint|finish|stain/, "finishing"],
    [/engineer|drawing|survey|design/, "engineering"], [/appliance|fixture/, "appliances"], [/content|furniture/, "contents"],
    [/hazard|asbestos|lead|mold/, "hazardous"], [/unforeseen|concealed|hidden/, "unforeseen"], [/change|additional/, "change_orders"],
  ];
  return map.find(([re]) => re.test(k))?.[1] ?? "custom";
}

export function ruleExclusions(input: GenerationInput, style: WritingStyle = input.style): ExclusionItem[] {
  const trades = tradeKeys(input);
  const have = new Set((input.existing ?? []).map((e) => e.category).filter((c) => c !== "custom"));
  const out: ExclusionItem[] = [];
  for (const c of CANDIDATES) {
    if (have.has(c.category) || !applies(c, trades)) continue;
    const cov = coverage(c.category, input);
    if (cov.included) continue; // never exclude work the estimate includes
    out.push({
      id: newId(), category: c.category, title: c.title, text: c.text[style], status: "suggested", source: "generated",
      review: cov.mentioned ? `Your scope or notes mention ${c.title.toLowerCase()} work. Confirm this exclusion still applies.` : null,
    });
  }
  return out;
}

/**
 * Guard applied to every generated exclusion (AI or rules): drop ones that exclude work the
 * estimate includes, flag ambiguous ones, de-duplicate against existing exclusions, and
 * force status "suggested" so nothing reaches the customer without contractor approval.
 */
export function guardExclusions(items: ExclusionItem[], input: GenerationInput): { kept: ExclusionItem[]; dropped: number } {
  const have = new Set((input.existing ?? []).map((e) => e.category).filter((c) => c !== "custom"));
  const seen = new Set<string>();
  const kept: ExclusionItem[] = [];
  let dropped = 0;
  for (const raw of items) {
    const category = canonicalCategory(raw.category);
    const cov = coverage(category, input);
    const textKey = `${raw.title} ${raw.text}`.toLowerCase().replace(/[^a-z]/g, "").slice(0, 80);
    if (cov.included || (category !== "custom" && (have.has(category) || seen.has(category))) || seen.has(textKey)) { dropped++; continue; }
    if (category !== "custom") seen.add(category);
    seen.add(textKey);
    kept.push({
      ...raw, category, status: "suggested", source: "generated",
      review: raw.review || (cov.mentioned ? "Your scope or notes mention this work. Confirm this exclusion still applies." : null),
    });
  }
  return { kept, dropped };
}

/* -------------------------------------------- Scope guard -------------------------------------- */

/** Commitments the scope must not introduce unless the estimate itself mentions them. */
const RISKY_TERMS: [RegExp, string][] = [
  [/warrant|guarantee/i, "warranty"],
  [/\bpermit/i, "permit"],
  [/\bcode[- ]?(compliant|compliance)|\bto code\b|meets? (all )?(local )?codes?/i, "code compliance"],
  [/\bdemoli|tear[- ]?(off|out)|\bremov(e|al) (of )?existing/i, "demolition"],
  [/\bdispos|haul[- ]?(away|off)|dumpster/i, "disposal"],
  [/\b(within|in) \d+ (business |working )?(days|weeks)|complete(d)? by\b|schedule/i, "schedule"],
  [/\binsur(ed|ance)\b|licensed|bonded/i, "licensing/insurance"],
];

function numbersIn(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  return out;
}

/**
 * Returns the problems with a generated scope, or [] if it only uses facts from the input.
 * Numbers must all come from the estimate; risky commitments must be supported by it.
 */
export function scopeProblems(text: string, input: GenerationInput): string[] {
  const source = [input.projectTitle, input.notes ?? "", ...input.trades, ...input.groups.flatMap((g) => [g.name, g.description ?? "", ...g.items.flatMap((i) => [i.name, i.description ?? "", i.quantity])])].join("\n");
  const allowed = numbersIn(source);
  const problems: string[] = [];
  const extra = [...numbersIn(text)].filter((n) => !allowed.has(n) && !["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].some((x) => x === n && /^\s*\d+[.)]/m.test(text)));
  if (extra.length) problems.push(`numbers not in the estimate: ${extra.slice(0, 5).join(", ")}`);
  for (const [re, label] of RISKY_TERMS) if (re.test(text) && !re.test(source)) problems.push(`unsupported ${label}`);
  return problems;
}
