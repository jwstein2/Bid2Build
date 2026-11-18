/**
 * Job recipes for the fictional demo company. Every price here is an ILLUSTRATIVE example for a
 * product demo, never a market average or a quote. Quantities are drawn inside each range by the
 * seeded generator (dataset.ts), so the same seed version always produces the same bids.
 *
 * Item tuple: [name, unit, costType, minQty, maxQty, unitCost]. A minQty === maxQty line is fixed.
 */
import type { CostType } from "../estimate/types";

export type RecipeItem = readonly [name: string, unit: string, cost: CostType, min: number, max: number, unitCost: number];
export interface RecipeGroup { name: string; items: readonly RecipeItem[] }
export interface JobRecipe {
  /** Catalog trade slug (src/lib/trades/data.ts). */
  trade: string;
  /** Title shown on the bid; "{last}" becomes the customer's last name. */
  title: string;
  groups: readonly RecipeGroup[];
  /** Working days a schedule usually needs (min, max). */
  days: readonly [number, number];
  scope: string;
  /** Markup percent used on this kind of job (illustrative). */
  markup: number;
  /** Relative frequency in the dataset. */
  weight: number;
}

export const RECIPES: readonly JobRecipe[] = [
  {
    trade: "concrete", title: "{last} driveway replacement", days: [3, 6], markup: 28, weight: 9,
    scope: "Remove the existing driveway, prepare the base, form and pour a new 4 in. reinforced concrete driveway with a broom finish and control joints.",
    groups: [
      { name: "Demolition & prep", items: [["Driveway tear-out and haul-away", "sq ft", "labor", 380, 720, 1.85], ["Class 5 base, compacted", "ton", "material", 12, 24, 32]] },
      { name: "Forming & reinforcement", items: [["Form boards and stakes", "lin ft", "material", 90, 160, 2.4], ["#4 rebar grid", "sq ft", "material", 380, 720, 0.62], ["Forming labor", "hour", "labor", 10, 18, 62]] },
      { name: "Pour & finish", items: [["Ready-mix concrete, 4,000 psi", "cu yd", "material", 6, 10, 168], ["Pour and broom finish crew", "hour", "labor", 14, 26, 64], ["Saw-cut control joints", "lin ft", "labor", 60, 120, 1.4], ["Cure and seal", "sq ft", "material", 380, 720, 0.28]] },
    ],
  },
  {
    trade: "concrete", title: "{last} patio slab", days: [2, 4], markup: 30, weight: 5,
    scope: "Excavate and pour a new stamped concrete patio off the back door, sloped away from the house.",
    groups: [
      { name: "Excavation & base", items: [["Excavation and grading", "sq ft", "labor", 220, 420, 1.6], ["Gravel base", "ton", "material", 6, 12, 32]] },
      { name: "Stamped concrete", items: [["Ready-mix concrete", "cu yd", "material", 3, 6, 168], ["Stamp, color and release", "sq ft", "material", 220, 420, 2.15], ["Placement and stamping crew", "hour", "labor", 12, 22, 66]] },
    ],
  },
  {
    trade: "decks", title: "{last} composite deck", days: [5, 9], markup: 30, weight: 10,
    scope: "Build a new composite deck with pressure-treated framing, concrete footings, aluminum railing and stairs to grade.",
    groups: [
      { name: "Footings & framing", items: [["Concrete footings, 12 in.", "each", "material", 8, 14, 46], ["Pressure-treated framing package", "lump sum", "material", 1, 1, 2380], ["Framing labor", "hour", "labor", 28, 46, 58]] },
      { name: "Decking & railing", items: [["Composite decking, 16 ft board", "each", "material", 60, 110, 62], ["Hidden fasteners", "box", "material", 6, 11, 48], ["Aluminum railing", "lin ft", "material", 36, 64, 54], ["Decking and railing install", "hour", "labor", 30, 52, 58]] },
      { name: "Stairs & permit", items: [["Stair kit with composite treads", "each", "material", 1, 1, 640], ["Building permit", "each", "permit", 1, 1, 185]] },
    ],
  },
  {
    trade: "roofing", title: "{last} roof replacement", days: [2, 4], markup: 26, weight: 10,
    scope: "Tear off existing shingles down to the deck, replace damaged sheathing, install ice and water shield, synthetic underlayment and architectural shingles with new flashing and ridge vent.",
    groups: [
      { name: "Tear-off", items: [["Tear-off and disposal", "square", "labor", 18, 34, 68], ["Dumpster rental", "each", "equipment", 1, 2, 465], ["Sheathing replacement allowance", "sheet", "material", 4, 12, 38]] },
      { name: "Roofing system", items: [["Architectural shingles", "square", "material", 19, 36, 128], ["Synthetic underlayment", "roll", "material", 4, 8, 96], ["Ice and water shield", "roll", "material", 3, 6, 118], ["Drip edge and flashing", "lin ft", "material", 160, 280, 2.1], ["Ridge vent", "lin ft", "material", 30, 60, 4.6], ["Install crew", "square", "labor", 19, 36, 92]] },
    ],
  },
  {
    trade: "siding", title: "{last} siding and trim", days: [5, 9], markup: 27, weight: 6,
    scope: "Remove existing siding, install house wrap and new vinyl siding with aluminum-wrapped trim and new J-channel at windows and doors.",
    groups: [
      { name: "Removal & wrap", items: [["Siding removal and disposal", "square", "labor", 18, 30, 48], ["House wrap and tape", "roll", "material", 3, 6, 178]] },
      { name: "Siding & trim", items: [["Insulated vinyl siding", "square", "material", 18, 30, 236], ["J-channel and starter", "piece", "material", 40, 80, 9.5], ["Trim coil wrap", "lin ft", "material", 120, 260, 3.4], ["Siding install crew", "square", "labor", 18, 30, 118]] },
    ],
  },
  {
    trade: "kitchens", title: "{last} kitchen remodel", days: [15, 28], markup: 32, weight: 7,
    scope: "Full kitchen remodel: demolition, new semi-custom cabinets, quartz countertops, tile backsplash, sink and faucet, lighting updates and finish painting.",
    groups: [
      { name: "Demolition", items: [["Kitchen demolition and haul-away", "lump sum", "labor", 1, 1, 1650]] },
      { name: "Cabinets & countertops", items: [["Semi-custom base cabinets", "each", "material", 8, 14, 410], ["Semi-custom wall cabinets", "each", "material", 6, 12, 330], ["Quartz countertop, installed", "sq ft", "subcontractor", 40, 70, 78], ["Cabinet install", "hour", "labor", 28, 44, 64]] },
      { name: "Backsplash & fixtures", items: [["Tile backsplash, installed", "sq ft", "subcontractor", 30, 55, 32], ["Sink and faucet allowance", "each", "material", 1, 1, 780], ["Plumbing connections", "each", "subcontractor", 1, 1, 690], ["Under-cabinet lighting", "lin ft", "subcontractor", 12, 24, 46]] },
      { name: "Finishes", items: [["Paint, walls and ceiling", "sq ft", "labor", 280, 480, 1.9], ["Permit", "each", "permit", 1, 1, 260]] },
    ],
  },
  {
    trade: "bathrooms", title: "{last} bathroom remodel", days: [9, 16], markup: 32, weight: 7,
    scope: "Remodel the bathroom with a new tiled shower, vanity, toilet, fixtures, exhaust fan and finish painting.",
    groups: [
      { name: "Demolition", items: [["Bathroom demolition", "lump sum", "labor", 1, 1, 980]] },
      { name: "Shower", items: [["Shower pan and waterproofing", "each", "material", 1, 1, 640], ["Porcelain wall tile", "sq ft", "material", 70, 120, 6.8], ["Tile setting", "sq ft", "labor", 70, 120, 14], ["Glass shower door", "each", "subcontractor", 1, 1, 1180]] },
      { name: "Fixtures & finishes", items: [["Vanity with top", "each", "material", 1, 1, 960], ["Toilet", "each", "material", 1, 1, 340], ["Plumbing rough-in and set", "lump sum", "subcontractor", 1, 1, 1450], ["Exhaust fan, ducted", "each", "subcontractor", 1, 1, 420], ["Paint", "sq ft", "labor", 120, 220, 2.1]] },
    ],
  },
  {
    trade: "painting", title: "{last} interior repaint", days: [3, 6], markup: 35, weight: 7,
    scope: "Prep, patch and paint walls, ceilings and trim in the listed rooms with two finish coats.",
    groups: [
      { name: "Prep", items: [["Surface prep, patching and caulk", "hour", "labor", 8, 18, 52], ["Masking and drop cloths", "lump sum", "material", 1, 1, 120]] },
      { name: "Paint", items: [["Interior wall paint", "gallon", "material", 8, 18, 46], ["Ceiling paint", "gallon", "material", 3, 6, 38], ["Trim enamel", "gallon", "material", 2, 4, 58], ["Painting labor", "hour", "labor", 34, 70, 52]] },
    ],
  },
  {
    trade: "drywall", title: "{last} basement drywall", days: [5, 9], markup: 30, weight: 5,
    scope: "Hang, tape and finish drywall in the basement to a level 4 finish, ready for paint.",
    groups: [
      { name: "Hang", items: [["1/2 in. drywall sheets", "sheet", "material", 50, 110, 16.5], ["Screws and adhesive", "lump sum", "material", 1, 1, 140], ["Hanging labor", "sheet", "labor", 50, 110, 14]] },
      { name: "Tape & finish", items: [["Joint compound and tape", "lump sum", "material", 1, 1, 260], ["Taping and finishing, level 4", "sq ft", "labor", 1600, 3400, 0.95]] },
    ],
  },
  {
    trade: "electrical", title: "{last} panel upgrade", days: [1, 3], markup: 30, weight: 6,
    scope: "Replace the existing service panel with a 200 A panel, new breakers, grounding and bonding, and coordinate the utility disconnect and inspection.",
    groups: [
      { name: "Service upgrade", items: [["200 A panel", "each", "material", 1, 1, 420], ["Breakers", "each", "material", 18, 30, 14], ["Grounding and bonding kit", "each", "material", 1, 1, 160], ["Electrician labor", "hour", "labor", 10, 16, 96]] },
      { name: "Permit & inspection", items: [["Electrical permit", "each", "permit", 1, 1, 145], ["Utility coordination", "lump sum", "labor", 1, 1, 180]] },
    ],
  },
  {
    trade: "general-contracting", title: "{last} garage addition", days: [25, 45], markup: 22, weight: 4,
    scope: "Build a detached two-car garage on a new slab with framed walls, trusses, roofing, siding, overhead door and electrical rough-in, coordinated with our trade partners.",
    groups: [
      { name: "Sitework & slab", items: [["Excavation and base", "lump sum", "subcontractor", 1, 1, 3200], ["Garage slab with footing", "sq ft", "subcontractor", 480, 720, 9.4]] },
      { name: "Framing & roof", items: [["Framing package", "lump sum", "material", 1, 1, 8400], ["Roof trusses", "each", "material", 13, 17, 210], ["Framing crew", "hour", "labor", 120, 180, 60], ["Roofing", "square", "subcontractor", 7, 10, 340]] },
      { name: "Exterior & openings", items: [["Siding package", "square", "subcontractor", 9, 13, 380], ["16 ft overhead door, installed", "each", "subcontractor", 1, 1, 2350], ["Service door and window", "lump sum", "material", 1, 1, 1100]] },
      { name: "Electrical & permits", items: [["Electrical rough-in and trim", "lump sum", "subcontractor", 1, 1, 2900], ["Building permit", "each", "permit", 1, 1, 640]] },
    ],
  },
  {
    trade: "pressure-washing", title: "{last} driveway and patio wash", days: [1, 1], markup: 45, weight: 4,
    scope: "Surface-clean the driveway, walkways and patio, pre-treat oil stains, and rinse.",
    groups: [
      { name: "Flatwork", items: [["Surface cleaning, concrete", "sq ft", "labor", 900, 1800, 0.14], ["Degreaser pre-treatment", "gallon", "material", 1, 3, 32], ["Post-treatment rinse", "lump sum", "labor", 1, 1, 60]] },
    ],
  },
  {
    trade: "soft-washing", title: "{last} house soft wash", days: [1, 1], markup: 45, weight: 4,
    scope: "Low-pressure soft wash of siding, soffits and gutters' exterior faces with plant protection before and after.",
    groups: [
      { name: "House wash", items: [["Soft wash, siding", "sq ft", "labor", 1800, 3200, 0.11], ["Cleaning solution", "gallon", "material", 3, 6, 18], ["Gutter face brightening", "lin ft", "labor", 120, 220, 0.6], ["Plant protection rinse", "lump sum", "labor", 1, 1, 45]] },
    ],
  },
];

/** Trade labels used in fictional business copy. */
export const DEMO_TRADES = [...new Set(RECIPES.map((r) => r.trade))];
