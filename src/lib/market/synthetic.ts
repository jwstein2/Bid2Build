/**
 * SYNTHETIC DEMO DATA for development dashboards.
 *
 * Every number here is invented by a seeded random generator. It exists only so the Market
 * Intelligence screens can be exercised before real contributions exist. It is stored with
 * is_synthetic = true, shown only when an admin explicitly selects the "Synthetic demo" dataset,
 * labelled on every screen, and never mixed with real observations.
 */
import { computeEstimate } from "../estimate/engine";
import type { CostType, Estimate, LineItem } from "../estimate/types";
import { buildObservation, type ObservationPayload } from "./capture";
import type { ProjectProfile } from "./trade-models";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spec { name: string; unit: string; costType: CostType; base: number; qty: (size: number) => number }
interface TradeSpec { trade: string; sizeKey: string; size: [number, number]; profile: (r: () => number, size: number) => ProjectProfile; groups: { name: string; items: Spec[] }[]; variants?: Spec[][] }

const ZIPS = ["60614", "75201", "77002", "85004", "30303", "98101", "80202", "28202", "37203", "55401", "43215", "46204", "64105", "19103", "02108", "33101", "92101", "97201", "84101", "53202"];

const TRADES: TradeSpec[] = [
  {
    trade: "decks", sizeKey: "area_sqft", size: [160, 600],
    profile: (r, size) => {
      const height = r() < 0.4 ? 6 + Math.round(r() * 6) : 1 + Math.round(r() * 2);
      return { sector: "residential", workType: "new_construction", projectType: r() < 0.85 ? "new_deck" : "resurface",
        measurements: { area_sqft: size, height_ft: height, railing_lf: Math.round(Math.sqrt(size) * (height > 3 ? 3 : 1)), stair_count: height > 3 ? 1 + Math.round(r()) : 0 } };
    },
    groups: [
      { name: "Framing & footings", items: [
        { name: "Pressure-treated framing lumber", unit: "square foot", costType: "material", base: 4.2, qty: (s) => s },
        { name: "Concrete footings", unit: "each", costType: "material", base: 85, qty: (s) => Math.ceil(s / 60) },
      ] },
      { name: "Decking", items: [] },
      { name: "Railing", items: [{ name: "Aluminum railing", unit: "linear foot", costType: "material", base: 38, qty: (s) => Math.round(Math.sqrt(s) * 2) }] },
      { name: "Labor", items: [{ name: "Deck installation labor", unit: "hour", costType: "labor", base: 62, qty: (s) => Math.round(s / 6) }] },
    ],
    variants: [
      [{ name: "Trex Enhance Basics deck boards", unit: "square foot", costType: "material", base: 7.4, qty: (s) => s }],
      [{ name: "Trex Select composite decking", unit: "square foot", costType: "material", base: 9.1, qty: (s) => s }],
      [{ name: "TimberTech AZEK Vintage decking", unit: "square foot", costType: "material", base: 15.5, qty: (s) => s }],
      [{ name: "Pressure-treated 5/4x6 deck boards", unit: "square foot", costType: "material", base: 3.1, qty: (s) => s }],
      [{ name: "Composite deck board", unit: "square foot", costType: "material", base: 7.9, qty: (s) => s }],
    ],
  },
  {
    trade: "roofing", sizeKey: "squares", size: [14, 42],
    profile: (r, size) => ({ sector: "residential", workType: "replacement", projectType: "replacement",
      measurements: { squares: size, layers_removed: r() < 0.25 ? 2 : 1, pitch: r() < 0.2 ? "steep" : r() < 0.6 ? "medium" : "low", access: r() < 0.15 ? "difficult" : "easy", tear_off: true } }),
    groups: [
      { name: "Tear-off", items: [{ name: "Tear-off existing shingles", unit: "square", costType: "labor", base: 55, qty: (s) => s }] },
      { name: "Roofing materials", items: [
        { name: "Synthetic underlayment", unit: "roll", costType: "material", base: 95, qty: (s) => Math.ceil(s / 10) },
        { name: "Drip edge flashing", unit: "linear foot", costType: "material", base: 1.6, qty: (s) => Math.round(Math.sqrt(s * 100) * 4) },
      ] },
      { name: "Installation", items: [{ name: "Shingle installation labor", unit: "square", costType: "labor", base: 95, qty: (s) => s }] },
    ],
    variants: [
      [{ name: "GAF Timberline HDZ shingles", unit: "square", costType: "material", base: 128, qty: (s) => s }],
      [{ name: "Owens Corning Duration shingles", unit: "square", costType: "material", base: 124, qty: (s) => s }],
      [{ name: "CertainTeed Landmark shingles", unit: "square", costType: "material", base: 126, qty: (s) => s }],
      [{ name: "3-tab asphalt shingles", unit: "square", costType: "material", base: 92, qty: (s) => s }],
    ],
  },
  {
    trade: "fencing", sizeKey: "length_lf", size: [80, 320],
    profile: (r, size) => ({ sector: "residential", workType: "new_construction", projectType: "new", measurements: { length_lf: size, height_ft: r() < 0.6 ? 6 : 4, gate_count: Math.round(r() * 2) } }),
    groups: [
      { name: "Fence", items: [{ name: "Fence installation labor", unit: "linear foot", costType: "labor", base: 14, qty: (s) => s }] },
      { name: "Gates", items: [{ name: "Walk gate", unit: "each", costType: "material", base: 240, qty: () => 1 }] },
    ],
    variants: [
      [{ name: "Cedar privacy fence panels", unit: "linear foot", costType: "material", base: 21, qty: (s) => s }],
      [{ name: "Vinyl privacy fence", unit: "linear foot", costType: "material", base: 26, qty: (s) => s }],
      [{ name: "Chain-link fence fabric", unit: "linear foot", costType: "material", base: 9, qty: (s) => s }],
    ],
  },
  {
    trade: "painting", sizeKey: "area_sqft", size: [900, 4200],
    profile: (r, size) => ({ sector: "residential", workType: "remodel", projectType: r() < 0.5 ? "interior" : "exterior", measurements: { area_sqft: size, coats: 2, prep: r() < 0.2 ? "heavy" : "moderate" } }),
    groups: [
      { name: "Materials", items: [
        { name: "Sherwin-Williams Duration exterior paint", unit: "gallon", costType: "material", base: 78, qty: (s) => Math.ceil(s / 175) },
        { name: "Primer", unit: "gallon", costType: "material", base: 32, qty: (s) => Math.ceil(s / 300) },
      ] },
      { name: "Labor", items: [{ name: "Painting labor", unit: "square foot", costType: "labor", base: 1.45, qty: (s) => s }] },
    ],
  },
  {
    trade: "kitchens", sizeKey: "area_sqft", size: [110, 260],
    profile: (r, size) => ({ sector: "residential", workType: "remodel", projectType: "full_remodel",
      measurements: { area_sqft: size, cabinetry: r() < 0.6 ? "semi_custom" : r() < 0.8 ? "stock" : "custom", countertop: r() < 0.7 ? "quartz" : "granite", layout: "l_shape", plumbing: r() < 0.3 ? "relocation" : "minor", electrical: "minor", demolition: true } }),
    groups: [
      { name: "Demolition", items: [{ name: "Kitchen demolition and haul-away", unit: "lump sum", costType: "labor", base: 1800, qty: () => 1 }] },
      { name: "Cabinets", items: [{ name: "Semi-custom cabinets", unit: "linear foot", costType: "material", base: 420, qty: (s) => Math.round(s / 7) }] },
      { name: "Countertops", items: [{ name: "Quartz countertop 3cm", unit: "square foot", costType: "material", base: 68, qty: (s) => Math.round(s / 4) }] },
      { name: "Installation", items: [{ name: "Cabinet installation labor", unit: "hour", costType: "labor", base: 70, qty: (s) => Math.round(s / 3) }] },
    ],
  },
  {
    trade: "concrete", sizeKey: "area_sqft", size: [300, 1200],
    profile: (r, size) => ({ sector: "residential", workType: "new_construction", projectType: r() < 0.6 ? "driveway" : "patio", measurements: { area_sqft: size, thickness_in: r() < 0.7 ? 4 : 6, finish: "broom" } }),
    groups: [
      { name: "Concrete", items: [
        { name: "Ready-mix concrete", unit: "cubic yard", costType: "material", base: 165, qty: (s) => Math.ceil(s / 75) },
        { name: "Wire mesh reinforcement", unit: "square foot", costType: "material", base: 0.35, qty: (s) => s },
      ] },
      { name: "Labor", items: [{ name: "Concrete flatwork labor", unit: "square foot", costType: "labor", base: 3.2, qty: (s) => s }] },
    ],
  },
];

// Regional price index per ZIP (synthetic), so geographic views show variation.
const REGION_INDEX: Record<string, number> = Object.fromEntries(ZIPS.map((z, i) => [z, 0.85 + ((i * 37) % 40) / 100]));

export interface SyntheticRow { contributor: number; captured_at: string; payload: ObservationPayload }

export function generateSyntheticDataset(opts: { contributors?: number; bidsPerContributor?: number; seed?: number; now?: Date } = {}): SyntheticRow[] {
  const contributors = opts.contributors ?? 120;
  const perC = opts.bidsPerContributor ?? 7;
  const r = rng(opts.seed ?? 20261112);
  const now = opts.now ?? new Date();
  const rows: SyntheticRow[] = [];
  for (let c = 0; c < contributors; c++) {
    const zip = ZIPS[c % ZIPS.length];
    const regional = REGION_INDEX[zip];
    const markup = 18 + Math.round(r() * 22);
    const sharesCosts = r() < 0.6;
    const specialty = TRADES[c % TRADES.length];
    for (let b = 0; b < perC; b++) {
      const spec = r() < 0.65 ? specialty : TRADES[Math.floor(r() * TRADES.length)];
      const daysAgo = Math.floor(r() * 540);
      const date = new Date(now.getTime() - daysAgo * 86400000);
      const drift = 1 + (0.06 * (540 - daysAgo)) / 540; // gentle upward trend over 18 months
      const size = Math.round(spec.size[0] + r() * (spec.size[1] - spec.size[0]));
      const profile = spec.profile(r, size);
      const groups = spec.groups.map((g, gi) => ({ id: `00000000-0000-4000-8000-${String(gi).padStart(12, "0")}`, name: g.name, visibility: null, sortOrder: gi }));
      const items: LineItem[] = [];
      const add = (s: Spec, gi: number) => {
        let price = s.base * regional * drift * (0.85 + r() * 0.3);
        if (r() < 0.006) price *= 9; // injected entry error (SY vs SF style) so the anomaly view has examples
        if (r() < 0.006) price *= 3.5; // injected outlier
        items.push({ id: `00000000-0000-4000-9000-${String(items.length).padStart(12, "0")}`, groupId: groups[gi].id, name: s.name, costType: s.costType, treatment: "marked_up",
          quantity: String(Math.max(1, s.qty(size))), unit: s.unit, unitCost: price.toFixed(2), taxable: s.costType === "material", showOnProposal: true, sortOrder: items.length });
      };
      spec.groups.forEach((g, gi) => g.items.forEach((s) => add(s, gi)));
      if (spec.variants) {
        const v = spec.variants[Math.floor(r() * spec.variants.length)];
        const gi = Math.max(0, spec.groups.findIndex((g) => g.items.length === 0));
        v.forEach((s) => add(s, gi === -1 ? 0 : gi));
      }
      const estimate: Estimate = {
        id: "00000000-0000-4000-8000-000000000000", title: "Synthetic", trades: [spec.trade], estimateNumber: "", estimateDate: date.toISOString().slice(0, 10),
        expirationDate: "", status: "finalized", customer: { name: "" }, location: { zip }, pricing: { mode: "markup", percent: String(markup) },
        fixedAdjustment: "0", taxRate: "6", displayMode: "by_group", defaultGroupVisibility: "names_only", groups: groups.filter((_, gi) => items.some((it) => it.groupId === groups[gi].id)), items,
        projectProfile: { ...profile, outcome: r() < 0.35 ? "accepted" : r() < 0.5 ? "declined" : "quoted" },
      };
      const totals = computeEstimate(estimate);
      rows.push({ contributor: c, captured_at: date.toISOString(), payload: buildObservation(estimate, totals, estimate.projectProfile, { sharePrices: true, shareCosts: sharesCosts }) });
    }
  }
  return rows;
}
