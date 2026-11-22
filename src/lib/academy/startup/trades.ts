import type { CredentialKey } from "./types";

/**
 * Which state credential categories matter for each trade. "core" = needed for the trade's normal work wherever the
 * state licenses it. "ifYou" = only when the contractor does a particular kind of work, with the plain reason shown.
 * Plain-language mapping written by Built2Bid; the state data says whether each category is actually licensed there.
 */
export interface TradeNeeds { core: CredentialKey[]; ifYou: { key: CredentialKey; when: string }[] }

const SELF_PERFORM = (what: string) => `if you do the ${what} work yourself instead of hiring a licensed sub`;
const COMMERCIAL = { key: "commercial_building" as const, when: "if you take commercial (non-residential) jobs" };
const ASBESTOS = { key: "asbestos" as const, when: "if you disturb or remove materials that may contain asbestos" };
const LEAD = { key: "lead_rrp" as const, when: "if you disturb paint in homes built before 1978" };
const PESTICIDE_WEEDS = { key: "pesticide" as const, when: "if you apply weed killer, insecticide or other pesticides for customers" };

const building = (extra: TradeNeeds["ifYou"] = []): TradeNeeds => ({ core: ["residential_building"], ifYou: [COMMERCIAL, LEAD, ...extra] });
const remodel = (extra: TradeNeeds["ifYou"] = []): TradeNeeds => building([
  { key: "electrical", when: SELF_PERFORM("electrical") },
  { key: "plumbing", when: SELF_PERFORM("plumbing") },
  { key: "mechanical", when: SELF_PERFORM("heating, ventilation or gas") },
  ASBESTOS,
  ...extra,
]);

export const TRADE_NEEDS: Record<string, TradeNeeds> = {
  roofing: { core: ["roofing", "residential_building"], ifYou: [COMMERCIAL, LEAD] },
  siding: building(),
  decks: building(),
  concrete: building(),
  kitchens: remodel(),
  bathrooms: remodel(),
  "interior-remodeling": remodel(),
  "exterior-remodeling": building([{ key: "roofing", when: "if you also replace roofs" }]),
  drywall: building([ASBESTOS]),
  painting: building(),
  electrical: { core: ["electrical"], ifYou: [COMMERCIAL, LEAD] },
  plumbing: { core: ["plumbing"], ifYou: [{ key: "mechanical", when: "if you install gas piping, water heaters or boilers your state licenses as mechanical work" }, LEAD] },
  hvac: { core: ["mechanical"], ifYou: [{ key: "electrical", when: "if you run new circuits instead of hiring an electrician" }, { key: "plumbing", when: "if you do gas piping your state licenses as plumbing" }, LEAD] },
  flooring: building([ASBESTOS]),
  tile: building(),
  framing: building(),
  "finish-carpentry": building(),
  "cabinets-countertops": building([{ key: "plumbing", when: SELF_PERFORM("sink and faucet") }]),
  "windows-doors": building(),
  insulation: building([ASBESTOS]),
  gutters: building(),
  fencing: building(),
  landscaping: { core: [], ifYou: [PESTICIDE_WEEDS, { key: "residential_building", when: "if you build retaining walls, patios or other structures your state licenses as contracting" }] },
  "tree-removal": { core: [], ifYou: [{ key: "pesticide", when: "if you spray or treat trees with pesticides" }] },
  "tree-trimming": { core: [], ifYou: [{ key: "pesticide", when: "if you spray or treat trees with pesticides" }] },
  "pressure-washing": { core: [], ifYou: [LEAD] },
  "soft-washing": { core: [], ifYou: [{ key: "pesticide", when: "if your cleaning solutions are registered as pesticides (many algae and mildew killers are)" }, LEAD] },
  cleaning: { core: [], ifYou: [] },
  "pest-control": { core: ["pesticide"], ifYou: [] },
  excavation: { core: ["residential_building"], ifYou: [COMMERCIAL] },
  foundations: building(),
  masonry: building(),
  "asphalt-paving": { core: ["residential_building"], ifYou: [COMMERCIAL] },
  demolition: { core: ["residential_building", "asbestos"], ifYou: [COMMERCIAL, LEAD] },
  basements: remodel(),
  additions: remodel([{ key: "roofing", when: "if you do the roofing yourself" }]),
  garages: building([{ key: "electrical", when: SELF_PERFORM("electrical") }]),
  "pole-barns": building([{ key: "electrical", when: SELF_PERFORM("electrical") }]),
  "commercial-remodeling": { core: ["commercial_building"], ifYou: [
    { key: "electrical", when: SELF_PERFORM("electrical") }, { key: "plumbing", when: SELF_PERFORM("plumbing") }, { key: "mechanical", when: SELF_PERFORM("HVAC") }, ASBESTOS, LEAD] },
  "general-contracting": { core: ["residential_building"], ifYou: [COMMERCIAL, ASBESTOS, LEAD] },
  handyman: { core: ["residential_building"], ifYou: [
    { key: "electrical", when: "if you do any electrical work beyond what your state allows unlicensed" }, { key: "plumbing", when: "if you do any plumbing beyond what your state allows unlicensed" }, LEAD] },
};

export const needsFor = (trade: string | null | undefined): TradeNeeds => (trade && TRADE_NEEDS[trade]) || { core: ["residential_building"], ifYou: [COMMERCIAL, LEAD] };

export const CREDENTIAL_LABEL: Record<CredentialKey, string> = {
  residential_building: "Residential contractor license",
  commercial_building: "Commercial contractor license",
  electrical: "Electrical license",
  plumbing: "Plumbing license",
  mechanical: "HVAC / mechanical license",
  roofing: "Roofing license",
  pesticide: "Pesticide applicator license",
  asbestos: "Asbestos license",
  lead_rrp: "Lead-safe renovation (state program)",
};
