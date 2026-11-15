/**
 * Building code references the pricing-guide writer may cite, per trade.
 *
 * These are section titles from the International Residential Code (IRC), published by the
 * International Code Council (ICC). Most US states and cities build their residential code on the
 * IRC, but each adopts its own edition and amends it, and some use other plumbing or electrical
 * codes. Guides therefore only name a section and what it covers, never a dimension, load or
 * other requirement, and always send readers to their local building department.
 *
 * The checker (article-checks.ts) rejects any section number a guide cites that is not listed for
 * that guide's trade, so the model cannot invent references. Edit this list to add more.
 */
export interface CodeRef { code: string; title: string }

const R = (code: string, title: string): CodeRef => ({ code, title });

const permits = R("R105", "Permits (which work needs a permit; Chapter 1 is often amended locally)");
const drainage = R("R401.3", "Drainage (grading so surface water flows away from the foundation)");
const smoke = R("R314", "Smoke alarms (including when alarms must be added during alterations)");
const co = R("R315", "Carbon monoxide alarms");
const egress = R("R310", "Emergency escape and rescue openings");
const stairs = R("R311.7", "Stairways (width, headroom, risers, treads and handrails)");
const guards = R("R312", "Guards and window fall protection");
const glazing = R("R308", "Glazing (safety glazing in hazardous locations)");
const garageSep = R("R302.6", "Dwelling-garage fire separation");
const decay = R("R317", "Protection of wood and wood-based products against decay");
const design = R("R301", "Design criteria (wind, snow, seismic and other loads for the location)");
const footings = R("R403", "Footings");
const fdnWalls = R("R404", "Foundation and retaining walls");
const fdnDrain = R("R405", "Foundation drainage");
const damp = R("R406", "Foundation waterproofing and dampproofing");
const slab = R("R506", "Concrete floors (on ground)");
const floorFraming = R("R502", "Wood floor framing");
const wallFraming = R("R602", "Wood wall framing");
const roofFraming = R("R802", "Wood roof framing");
const windowsDoors = R("R609", "Exterior windows and doors");
const interiorCovering = R("R702", "Interior covering");
const gypsum = R("R702.3", "Gypsum board and gypsum panel products");
const tile = R("R702.4", "Ceramic tile");
const exteriorCovering = R("R703", "Exterior covering (siding, water-resistive barrier and flashing)");
const flashing = R("R703.4", "Flashing (around windows, doors and wall penetrations)");
const veneer = R("R703.8", "Anchored stone and masonry veneer");
const masonry = R("R606", "General masonry construction");
const roofVent = R("R806", "Roof ventilation");
const sheathing = R("R803", "Roof sheathing");
const roofDrain = R("R801.3", "Roof drainage");
const weather = R("R903", "Weather protection (roof flashing and drainage)");
const roofCoverings = R("R905", "Requirements for roof coverings (underlayment, fastening and installation by material)");
const reroof = R("R908", "Reroofing (recovering versus replacing, and reinstalling flashing)");
const envelope = R("N1102", "Building thermal envelope (insulation, fenestration and air leakage, Chapter 11 energy efficiency)");
const systems = R("N1103", "Systems (duct sealing and insulation, controls, Chapter 11 energy efficiency)");
const foam = R("R316", "Foam plastic");
const bathVent = R("R303.3", "Bathrooms (ventilation by window or exhaust fan)");
const bathSpaces = R("R307", "Toilet, bath and shower spaces (fixture clearances)");
const ceiling = R("R305", "Ceiling height");
const garages = R("R309", "Garages and carports");
const outlets = R("E3901", "Receptacle outlets (including kitchen countertops and bathrooms)");
const gfci = R("E3902", "Ground-fault and arc-fault circuit-interrupter protection");
const rangeHood = R("M1503", "Range hoods");
const exhaust = R("M1501", "Exhaust systems (Chapter 15)");
const ducts = R("M1601", "Duct construction (Chapter 16)");
const equipment = R("M1401", "Heating and cooling equipment (Chapter 14)");
const fixtures = R("P2701", "Plumbing fixtures (Chapter 27)");
const showers = R("P2708", "Showers");
const receptors = R("P2709", "Shower receptors (pans and liners)");
const waterHeaters = R("P2801", "Water heaters (Chapter 28)");
const decks = R("R507", "Exterior decks (footings, ledger attachment, joists, beams and posts)");

const CODE_REFS: Record<string, CodeRef[]> = {
  roofing: [roofCoverings, reroof, weather, roofVent, sheathing, roofFraming],
  siding: [exteriorCovering, flashing, veneer, foam],
  decks: [decks, guards, stairs, decay, footings, permits],
  concrete: [footings, slab, fdnWalls, drainage],
  kitchens: [outlets, gfci, rangeHood, fixtures, permits],
  bathrooms: [bathVent, bathSpaces, glazing, showers, receptors, gfci, tile],
  "interior-remodeling": [smoke, co, egress, stairs, gypsum, gfci, permits],
  "exterior-remodeling": [exteriorCovering, flashing, windowsDoors, weather, decay],
  drywall: [gypsum, interiorCovering, garageSep],
  electrical: [outlets, gfci, smoke, permits],
  plumbing: [fixtures, waterHeaters, showers, receptors, permits],
  hvac: [equipment, ducts, exhaust, systems, co],
  tile: [tile, receptors, showers, interiorCovering],
  framing: [wallFraming, floorFraming, roofFraming, design, decay],
  "finish-carpentry": [stairs, guards, interiorCovering],
  "cabinets-countertops": [outlets, rangeHood, gfci],
  "windows-doors": [windowsDoors, glazing, egress, flashing, envelope],
  insulation: [envelope, roofVent, foam, systems],
  gutters: [roofDrain, weather, drainage],
  excavation: [footings, drainage, fdnDrain],
  foundations: [footings, fdnWalls, fdnDrain, damp, drainage],
  masonry: [masonry, veneer, fdnWalls, footings],
  basements: [egress, ceiling, damp, fdnDrain, smoke, co],
  additions: [design, footings, wallFraming, roofFraming, envelope, smoke, permits],
  garages: [garages, garageSep, slab, footings, permits],
  "pole-barns": [design, footings, decay, permits],
  "general-contracting": [permits, design, smoke, co, envelope],
  handyman: [permits, guards, stairs, smoke, gfci],
  landscaping: [drainage, fdnWalls],
};

/** IRC sections a guide for this trade may cite (empty for trades the IRC does not cover, such as washing or paving). */
export function codeRefsFor(trade: string | undefined): CodeRef[] {
  return trade ? (CODE_REFS[trade] ?? []) : [permits, design];
}

/** Matches an IRC section number such as R507, R311.7, N1102, E3902 or P2709. */
export const CODE_CITATION = /\b[RNMPE]\d{3,4}(?:\.\d+)*\b/g;
