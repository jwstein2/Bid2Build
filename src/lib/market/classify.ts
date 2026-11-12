/**
 * Deterministic line-item classification.
 *
 * Turns free-text item names ("Trex Enhance Basics 1×6", "composite deck board") into structured
 * attributes: component, material, brand, product line, specs, cost class, and a confidence score.
 *
 * Design rule: never merge materials that price differently. The comparison key (`materialKey`)
 * only becomes more specific as evidence is found, so "Trex decking" (line unknown) is never pooled
 * with "Trex Transcend" and generic "composite decking" is never pooled with either.
 */
import type { CostType } from "../estimate/types";
import { normalizeUnit } from "./units";

export type CostClass = "labor" | "material" | "equipment" | "subcontractor" | "other";

export interface Classification {
  fingerprint: string;
  trade: string | null;
  component: string | null;
  material: string | null;
  /** component.material, or component, or "unclassified". */
  category: string;
  brand: string | null;
  productLine: string | null;
  specs: Record<string, string | number>;
  installType: "install" | "removal" | "repair" | "replacement" | null;
  costClass: CostClass;
  /** Most specific key this observation may be compared under. */
  materialKey: string;
  confidence: number;
  method: "rule";
  /** The text suggests a different cost class than the contractor chose (e.g. "install labor" marked material). */
  classConflict: boolean;
}

/** Observations below this confidence are excluded from precise material comparisons until reviewed. */
export const PRECISE_CONFIDENCE = 0.75;

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[×]/g, "x")
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9/'".\-x& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Components (what part of the job) — ordered most specific first.
// ---------------------------------------------------------------------------
const COMPONENTS: { key: string; re: RegExp }[] = [
  { key: "tear_off", re: /\b(tear[- ]?off|strip (the )?(existing )?(roof|shingles)|remove (existing )?(shingles|roof))\b/ },
  { key: "underlayment", re: /\b(underlayment|felt paper|\d+ ?lb felt|ice (and|&) water|ice shield|feltbuster|tiger paw|synthetic felt)\b/ },
  { key: "flashing", re: /\b(flashing|drip edge|step flash|counter ?flash|valley metal|pipe boot)\b/ },
  { key: "ridge", re: /\b(ridge (cap|vent)|hip (and|&) ridge|ridge shingles?)\b/ },
  { key: "shingles", re: /\b(shingles?|timberline|duration|landmark|oakridge|architectural roof|3[- ]tab)\b/ },
  { key: "metal_roofing", re: /\b(standing seam|metal roof(ing)? panels?|r[- ]panel|metal roof)\b/ },
  { key: "roof_sheathing", re: /\b(roof (deck|sheathing)|sheathing|osb|plywood decking)\b/ },
  { key: "railing", re: /\b(railings?|rail kit|balusters?|guard ?rail|handrail|top rail|rail post)\b/ },
  { key: "stairs", re: /\b(stairs?|stair treads?|treads?|stringers?|risers?|steps)\b/ },
  { key: "footings", re: /\b(footings?|piers?|sono ?tubes?|helical|post bases?|concrete footing)\b/ },
  { key: "fasteners", re: /\b(fasteners?|hidden fastener|screws?|nails?|joist hangers?|hangers|brackets?|clips?|camo|cortex|simpson)\b/ },
  { key: "decking", re: /\b(deck(ing)? boards?|decking|deck surface|composite boards?|resurfac\w*)\b/ },
  { key: "framing", re: /\b(joists?|beams?|ledger|rim board|blocking|framing|posts?|studs?|headers?)\b/ },
  { key: "countertops", re: /\b(counter ?tops?|counters?|quartz|granite|marble|butcher ?block|solid surface|silestone|caesarstone|cambria)\b/ },
  { key: "backsplash", re: /\bback ?splash\b/ },
  { key: "cabinets", re: /\b(cabinets?|cabinetry|vanity base|kraftmaid|merillat|shenandoah)\b/ },
  { key: "appliances", re: /\b(appliances?|refrigerator|fridge|range|cooktop|dishwasher|microwave|wall oven|range hood|oven)\b/ },
  { key: "sink_faucet", re: /\b(sinks?|faucets?|disposal unit|garbage disposal)\b/ },
  { key: "toilet", re: /\btoilets?\b/ },
  { key: "shower_tub", re: /\b(shower|bathtub|tub surround|tub|shower pan|shower valve)\b/ },
  { key: "vanity", re: /\bvanit(y|ies)\b/ },
  { key: "water_heater", re: /\b(water heater|tankless)\b/ },
  { key: "piping", re: /\b(pex|copper pipe|pvc pipe|drain line|supply line|repipe|piping|plumbing rough)\b/ },
  { key: "hvac_equipment", re: /\b(furnace|air handler|condenser|heat pump|mini[- ]split|a\/?c unit|air conditioner|boiler)\b/ },
  { key: "ductwork", re: /\b(duct(work)?|registers?|returns?|plenum)\b/ },
  { key: "electrical_panel", re: /\b(panel|breaker box|service upgrade|load center|subpanel|\d+ ?amp service)\b/ },
  { key: "electrical_devices", re: /\b(outlets?|receptacles?|switch(es)?|gfci|recessed lights?|can lights?|light fixtures?|fixtures?|circuits?|wiring|romex)\b/ },
  { key: "flooring", re: /\b(lvp|lvt|luxury vinyl|vinyl plank|hardwood floor\w*|engineered hardwood|laminate floor\w*|carpet|flooring|floor tile)\b/ },
  { key: "tile", re: /\b(tile|porcelain|ceramic|grout|thinset|backer ?board|schluter)\b/ },
  { key: "drywall", re: /\b(drywall|sheetrock|gypsum|wallboard|tape (and|&) mud|mudding|taping)\b/ },
  { key: "paint", re: /\b(paint(ing)?|primer|stain(ing)?|coats?|emerald|duration paint|regal select|superpaint)\b/ },
  { key: "siding", re: /\b(siding|hardie ?plank|hardie|lap siding|board (and|&) batten|soffit|fascia|smartside|vinyl siding)\b/ },
  { key: "gutters", re: /\b(gutters?|downspouts?|leaf guard|gutter guard)\b/ },
  { key: "windows", re: /\b(windows?|double[- ]hung|casement|sliders?|picture window)\b/ },
  { key: "doors", re: /\b(doors?|entry door|patio door|storm door|garage door|slab door|prehung)\b/ },
  { key: "fence", re: /\b(fence|fencing|pickets?|chain[- ]link|fence panels?|gates?)\b/ },
  { key: "concrete", re: /\b(concrete|slab|flatwork|rebar|wire mesh|ready[- ]mix|driveway pour|sidewalk)\b/ },
  { key: "asphalt", re: /\b(asphalt|blacktop|sealcoat|paving)\b/ },
  { key: "insulation", re: /\b(insulation|batts?|blown[- ]in|spray foam|r-\d+)\b/ },
  { key: "masonry", re: /\b(brick|block|cmu|stone veneer|masonry|mortar|pavers?)\b/ },
  { key: "excavation", re: /\b(excavat\w*|grading|trench\w*|backfill|dig(ging)?)\b/ },
  { key: "landscaping", re: /\b(mulch|sod|plants?|shrubs?|topsoil|landscap\w*|seed(ing)?|trees?)\b/ },
  { key: "demolition", re: /\b(demo(lition)?|haul[- ]?away|dumpster|debris|disposal|removal)\b/ },
  { key: "permit", re: /\b(permits?|inspection fees?)\b/ },
  { key: "cleanup", re: /\b(clean ?up|final clean)\b/ },
];

// ---------------------------------------------------------------------------
// Materials (what it is made of), checked within the item text.
// ---------------------------------------------------------------------------
const MATERIALS: { key: string; re: RegExp; components?: string[] }[] = [
  { key: "pvc", re: /\b(pvc|cellular pvc|azek)\b/, components: ["decking", "railing", "stairs", "fence", "siding", "trim"] },
  { key: "composite", re: /\b(composite|capped composite|wpc)\b/ },
  { key: "pressure_treated", re: /\b(pressure[- ]?treated|p\.?t\.?|treated (pine|lumber)|syp|southern yellow pine|ground contact)\b/ },
  { key: "cedar", re: /\bcedar\b/ },
  { key: "redwood", re: /\bredwood\b/ },
  { key: "tropical_hardwood", re: /\b(ipe|cumaru|tigerwood|garapa|batu|mahogany)\b/ },
  { key: "aluminum", re: /\baluminum\b/ },
  { key: "cable", re: /\bcable\b/, components: ["railing"] },
  { key: "glass", re: /\bglass\b/, components: ["railing", "shower_tub", "doors"] },
  { key: "steel", re: /\b(steel|galvanized|wrought iron)\b/ },
  { key: "vinyl", re: /\bvinyl\b/ },
  { key: "architectural_asphalt", re: /\b(architectural|dimensional|laminated|timberline|duration|landmark|cambridge|heritage|pinnacle)\b/, components: ["shingles"] },
  { key: "three_tab_asphalt", re: /\b(3[- ]tab|three[- ]tab|royal sovereign|supreme|xt ?25)\b/, components: ["shingles"] },
  { key: "synthetic", re: /\b(synthetic)\b/, components: ["underlayment"] },
  { key: "felt", re: /\b(felt|\d+ ?lb)\b/, components: ["underlayment"] },
  { key: "ice_water", re: /\b(ice (and|&) water|ice shield)\b/, components: ["underlayment"] },
  { key: "quartz", re: /\b(quartz|silestone|caesarstone|cambria)\b/ },
  { key: "granite", re: /\bgranite\b/ },
  { key: "marble", re: /\bmarble\b/ },
  { key: "laminate", re: /\blaminate\b/ },
  { key: "butcher_block", re: /\bbutcher ?block\b/ },
  { key: "solid_surface", re: /\b(solid surface|corian)\b/ },
  { key: "fiber_cement", re: /\b(fiber cement|hardie\w*)\b/ },
  { key: "engineered_wood", re: /\b(engineered wood|smartside|lp smart)\b/ },
  { key: "lvp", re: /\b(lvp|lvt|luxury vinyl|vinyl plank|spc|rigid core)\b/ },
  { key: "hardwood", re: /\b(hardwood|oak|maple|hickory|walnut)\b/ },
  { key: "carpet", re: /\bcarpet\b/ },
  { key: "porcelain", re: /\bporcelain\b/ },
  { key: "ceramic", re: /\bceramic\b/ },
  { key: "stock", re: /\b(stock|rta|ready to assemble|builder grade)\b/, components: ["cabinets"] },
  { key: "semi_custom", re: /\bsemi[- ]custom\b/, components: ["cabinets"] },
  { key: "custom", re: /\b(?<!semi[- ])custom\b/, components: ["cabinets"] },
  { key: "chain_link", re: /\bchain[- ]link\b/ },
  { key: "concrete", re: /\bconcrete\b/, components: ["footings", "stairs", "masonry"] },
  { key: "wood", re: /\b(wood|lumber|pine|spruce|fir|spf|dimensional lumber)\b/ },
];

// ---------------------------------------------------------------------------
// Brands and product lines. `implies` fills material when the text doesn't say it.
// ---------------------------------------------------------------------------
interface BrandDef {
  name: string;
  re: RegExp;
  /** Component assumed when the text names only the brand/line (e.g. "Trex Enhance" = decking). */
  defaultComponent?: string;
  implies?: Partial<Record<string, string>>;
  lines?: { name: string; re: RegExp; implies?: string; component?: string }[];
}
const BRANDS: BrandDef[] = [
  {
    name: "Trex", re: /\btrex\b/, defaultComponent: "decking", implies: { decking: "composite", stairs: "composite", railing: "composite" },
    lines: [
      { name: "Transcend Lineage", re: /\btranscend lineage\b/ }, { name: "Transcend", re: /\btranscend\b/ },
      { name: "Select", re: /\bselect\b/ }, { name: "Enhance Naturals", re: /\benhance naturals?\b/ },
      { name: "Enhance Basics", re: /\benhance basics?\b/ }, { name: "Enhance", re: /\benhance\b/ },
      { name: "Signature", re: /\bsignature\b/, implies: "aluminum", component: "railing" },
    ],
  },
  {
    name: "TimberTech", re: /\btimber ?tech\b/, defaultComponent: "decking", implies: { decking: "composite", railing: "composite" },
    lines: [
      { name: "AZEK Vintage", re: /\bvintage\b/, implies: "pvc" }, { name: "AZEK Harvest", re: /\bharvest\b/, implies: "pvc" },
      { name: "AZEK Landmark", re: /\blandmark\b/, implies: "pvc" }, { name: "Pro Reserve", re: /\breserve\b/ },
      { name: "Pro Legacy", re: /\blegacy\b/ }, { name: "Pro Terrain", re: /\bterrain\b/ },
      { name: "Edge Prime", re: /\bprime\b/ }, { name: "Edge Premier", re: /\bpremier\b/ },
    ],
  },
  { name: "AZEK", re: /\bazek\b/, defaultComponent: "decking", implies: { decking: "pvc", railing: "pvc", trim: "pvc" } },
  {
    name: "Fiberon", re: /\bfiberon\b/, defaultComponent: "decking", implies: { decking: "composite" },
    lines: [{ name: "Paramount", re: /\bparamount\b/, implies: "pvc" }, { name: "Concordia", re: /\bconcordia\b/ }, { name: "Good Life", re: /\bgood ?life\b/ }, { name: "ArmorGuard", re: /\barmor ?guard\b/ }, { name: "Sanctuary", re: /\bsanctuary\b/ }],
  },
  { name: "Deckorators", re: /\bdeckorators\b/, defaultComponent: "decking", implies: { decking: "composite" }, lines: [{ name: "Voyage", re: /\bvoyage\b/ }, { name: "Vista", re: /\bvista\b/ }, { name: "Summit", re: /\bsummit\b/ }] },
  { name: "MoistureShield", re: /\bmoisture ?shield\b/, defaultComponent: "decking", implies: { decking: "composite" } },
  { name: "Fortress", re: /\bfortress\b/, defaultComponent: "railing", implies: { railing: "steel" } },
  {
    name: "GAF", re: /\bgaf\b|\btimberline\b/, defaultComponent: "shingles", implies: { shingles: "architectural_asphalt" },
    lines: [{ name: "Timberline UHDZ", re: /\buhdz\b/ }, { name: "Timberline HDZ", re: /\bhdz\b/ }, { name: "Timberline NS", re: /\btimberline ns\b/ }, { name: "Royal Sovereign", re: /\broyal sovereign\b/, implies: "three_tab_asphalt" }, { name: "FeltBuster", re: /\bfeltbuster\b/, implies: "synthetic", component: "underlayment" }, { name: "Tiger Paw", re: /\btiger paw\b/, implies: "synthetic", component: "underlayment" }],
  },
  {
    name: "Owens Corning", re: /\bowens ?corning\b|\boc duration\b/, implies: { shingles: "architectural_asphalt", insulation: "fiberglass" },
    lines: [{ name: "Duration", re: /\bduration\b/ }, { name: "Oakridge", re: /\boakridge\b/ }, { name: "Supreme", re: /\bsupreme\b/, implies: "three_tab_asphalt" }],
  },
  { name: "CertainTeed", re: /\bcertain ?teed\b/, lines: [{ name: "Landmark Pro", re: /\blandmark pro\b/, implies: "architectural_asphalt" }, { name: "Landmark", re: /\blandmark\b/, implies: "architectural_asphalt" }, { name: "XT 25", re: /\bxt ?25\b/, implies: "three_tab_asphalt" }, { name: "Monogram", re: /\bmonogram\b/, implies: "vinyl" }] },
  { name: "IKO", re: /\biko\b/, implies: { shingles: "architectural_asphalt" }, lines: [{ name: "Cambridge", re: /\bcambridge\b/ }, { name: "Dynasty", re: /\bdynasty\b/ }] },
  { name: "Atlas", re: /\batlas\b/, implies: { shingles: "architectural_asphalt" }, lines: [{ name: "Pinnacle", re: /\bpinnacle\b/ }] },
  { name: "TAMKO", re: /\btamko\b/, implies: { shingles: "architectural_asphalt" }, lines: [{ name: "Heritage", re: /\bheritage\b/ }] },
  { name: "Malarkey", re: /\bmalarkey\b/, implies: { shingles: "architectural_asphalt" } },
  { name: "James Hardie", re: /\b(james hardie|hardie\w*)\b/, defaultComponent: "siding", implies: { siding: "fiber_cement" }, lines: [{ name: "HardiePlank", re: /\bhardie ?plank\b/ }, { name: "HardiePanel", re: /\bhardie ?panel\b/ }, { name: "HardieTrim", re: /\bhardie ?trim\b/ }] },
  { name: "LP SmartSide", re: /\b(lp smart ?side|smart ?side)\b/, defaultComponent: "siding", implies: { siding: "engineered_wood" } },
  { name: "Andersen", re: /\bandersen\b/, lines: [{ name: "100 Series", re: /\b100 series\b/ }, { name: "200 Series", re: /\b200 series\b/ }, { name: "400 Series", re: /\b400 series\b/ }, { name: "A-Series", re: /\ba[- ]series\b/ }, { name: "E-Series", re: /\be[- ]series\b/ }] },
  { name: "Pella", re: /\bpella\b/, lines: [{ name: "250 Series", re: /\b250 series\b/ }, { name: "Lifestyle", re: /\blifestyle\b/ }, { name: "Architect", re: /\barchitect\b/ }, { name: "Impervia", re: /\bimpervia\b/ }] },
  { name: "Marvin", re: /\bmarvin\b/, lines: [{ name: "Elevate", re: /\belevate\b/ }, { name: "Essential", re: /\bessential\b/ }, { name: "Ultimate", re: /\bultimate\b/ }] },
  { name: "Milgard", re: /\bmilgard\b/ }, { name: "JELD-WEN", re: /\bjeld[- ]?wen\b/ }, { name: "ProVia", re: /\bprovia\b/ }, { name: "Simonton", re: /\bsimonton\b/ },
  { name: "Kohler", re: /\bkohler\b/ }, { name: "Moen", re: /\bmoen\b/ }, { name: "Delta", re: /\bdelta\b/ }, { name: "American Standard", re: /\bamerican standard\b/ },
  { name: "Rheem", re: /\brheem\b/ }, { name: "A. O. Smith", re: /\ba\.? ?o\.? smith\b/ }, { name: "Bradford White", re: /\bbradford white\b/ }, { name: "Navien", re: /\bnavien\b/ }, { name: "Rinnai", re: /\brinnai\b/ },
  { name: "Carrier", re: /\bcarrier\b/ }, { name: "Trane", re: /\btrane\b/ }, { name: "Lennox", re: /\blennox\b/ }, { name: "Goodman", re: /\bgoodman\b/ }, { name: "Mitsubishi", re: /\bmitsubishi\b/ }, { name: "Daikin", re: /\bdaikin\b/ }, { name: "Fujitsu", re: /\bfujitsu\b/ },
  { name: "KraftMaid", re: /\bkraft ?maid\b/ }, { name: "Merillat", re: /\bmerillat\b/ }, { name: "Shenandoah", re: /\bshenandoah\b/ }, { name: "Hampton Bay", re: /\bhampton bay\b/, implies: { cabinets: "stock" } },
  { name: "Silestone", re: /\bsilestone\b/, implies: { countertops: "quartz" } }, { name: "Caesarstone", re: /\bcaesarstone\b/, implies: { countertops: "quartz" } }, { name: "Cambria", re: /\bcambria\b/, implies: { countertops: "quartz" } },
  { name: "Shaw", re: /\bshaw\b/ }, { name: "Mohawk", re: /\bmohawk\b/ }, { name: "LifeProof", re: /\blife ?proof\b/, implies: { flooring: "lvp" } }, { name: "COREtec", re: /\bcore ?tec\b/, implies: { flooring: "lvp" } }, { name: "Pergo", re: /\bpergo\b/, implies: { flooring: "laminate" } },
  { name: "Sherwin-Williams", re: /\b(sherwin[- ]?williams|sw)\b/, lines: [{ name: "Emerald", re: /\bemerald\b/ }, { name: "Duration", re: /\bduration\b/ }, { name: "SuperPaint", re: /\bsuper ?paint\b/ }, { name: "ProClassic", re: /\bpro ?classic\b/ }, { name: "A-100", re: /\ba-?100\b/ }] },
  { name: "Benjamin Moore", re: /\b(benjamin moore|ben moore)\b/, lines: [{ name: "Aura", re: /\baura\b/ }, { name: "Regal Select", re: /\bregal\b/ }, { name: "Advance", re: /\badvance\b/ }] },
  { name: "Behr", re: /\bbehr\b/, lines: [{ name: "Marquee", re: /\bmarquee\b/ }, { name: "Ultra", re: /\bultra\b/ }, { name: "Premium Plus", re: /\bpremium plus\b/ }] },
  { name: "USG Sheetrock", re: /\b(usg|sheetrock)\b/ }, { name: "Rockwool", re: /\brockwool\b/, implies: { insulation: "mineral_wool" } },
  { name: "Simpson Strong-Tie", re: /\bsimpson\b/ }, { name: "CAMO", re: /\bcamo\b/ }, { name: "FastenMaster", re: /\b(fastenmaster|cortex)\b/ },
];

const LABOR_WORDS = /\b(labor|labour|install(ation|ed|er)?|crew|man[- ]?hours?|hourly|workmanship|carpenter|electrician|plumber|technician)\b/;
const SUB_WORDS = /\b(sub(contract(or|ed)?)?|subbed)\b/;
const EQUIPMENT_WORDS = /\b(rental|rent|dumpster|lift|excavator|skid steer|bobcat|scaffold(ing)?|equipment)\b/;

function costClassOf(t: CostType): CostClass {
  switch (t) {
    case "material": return "material";
    case "labor": case "labor_burden": return "labor";
    case "equipment": return "equipment";
    case "subcontractor": return "subcontractor";
    default: return "other";
  }
}

function extractSpecs(text: string): Record<string, string | number> {
  const specs: Record<string, string | number> = {};
  const dim = /\b(\d+(?:\/\d+)?|\d+\.\d+)\s?x\s?(\d+(?:\.\d+)?)\b/.exec(text);
  if (dim) specs.nominal = `${dim[1]}x${dim[2]}`;
  const len = /\b(\d{1,2})\s?(?:'|ft\b|foot\b|feet\b)(?!\s?(?:sq|square|x))/.exec(text);
  if (len && Number(len[1]) >= 4 && Number(len[1]) <= 24) specs.length_ft = Number(len[1]);
  const thick = /\b(\d(?:\.\d)?)\s?cm\b/.exec(text);
  if (thick) specs.thickness_cm = Number(thick[1]);
  const tons = /\b(\d(?:\.\d)?)\s?ton\b/.exec(text);
  if (tons) specs.tons = Number(tons[1]);
  const seer = /\b(\d{2}(?:\.\d)?)\s?seer2?\b/.exec(text);
  if (seer) specs.seer = Number(seer[1]);
  const gal = /\b(\d{2,3})\s?(?:gal|gallon)\b/.exec(text);
  if (gal) specs.gallons = Number(gal[1]);
  const amp = /\b(\d{2,3})\s?(?:a|amp|amps)\b/.exec(text);
  if (amp) specs.amps = Number(amp[1]);
  const r = /\br-?(\d{2})\b/.exec(text);
  if (r) specs.r_value = Number(r[1]);
  const gauge = /\b(\d{2})\s?(?:ga|gauge)\b/.exec(text);
  if (gauge) specs.gauge = Number(gauge[1]);
  if (/\bgrooved\b/.test(text)) specs.edge = "grooved";
  else if (/\bsquare edge\b/.test(text)) specs.edge = "square";
  return specs;
}

function installTypeOf(text: string): Classification["installType"] {
  if (/\b(tear[- ]?off|remove|removal|demo(lition)?|haul)\b/.test(text)) return "removal";
  if (/\brepair|patch\b/.test(text)) return "repair";
  if (/\breplace(ment)?\b/.test(text)) return "replacement";
  if (LABOR_WORDS.test(text)) return "install";
  return null;
}

export interface ClassifyInput {
  name: string;
  description?: string;
  category?: string;
  costType: CostType;
  unit: string;
  trade?: string | null;
}

export function fingerprintOf(input: Pick<ClassifyInput, "name" | "costType" | "trade">): string {
  return `${input.trade ?? "any"}::${normalizeText(input.name).slice(0, 160)}::${costClassOf(input.costType)}`;
}

/** Classify one line item. Only the item name (+ optional category) is used: descriptions and notes can contain customer details. */
export function classifyItem(input: ClassifyInput): Classification {
  const text = normalizeText(`${input.name} ${input.category ?? ""}`);
  const entered = costClassOf(input.costType);

  const brand = BRANDS.find((b) => b.re.test(text)) ?? null;
  const line = brand?.lines?.find((l) => l.re.test(text)) ?? null;
  const textComponent = COMPONENTS.find((c) => c.re.test(text))?.key ?? null;
  const component = textComponent ?? line?.component ?? brand?.defaultComponent ?? null;

  let material = MATERIALS.find((m) => m.re.test(text) && (!m.components || (component !== null && m.components.includes(component))))?.key ?? null;
  let materialImplied = false;
  if (!material && line?.implies) { material = line.implies; materialImplied = true; }
  if (!material && brand?.implies && component && brand.implies[component]) { material = brand.implies[component]!; materialImplied = true; }

  // Cost class: the contractor's choice wins; contradicting text lowers confidence and is flagged.
  let costClass = entered;
  let classConflict = false;
  const laborText = LABOR_WORDS.test(text);
  if (entered === "material" && laborText && !brand) classConflict = true;
  if (entered === "labor" && (brand || (material && !laborText))) classConflict = true;
  if (entered === "other") {
    if (laborText) costClass = "labor";
    else if (SUB_WORDS.test(text)) costClass = "subcontractor";
    else if (EQUIPMENT_WORDS.test(text)) costClass = "equipment";
  }

  const specs = extractSpecs(text);
  const unit = normalizeUnit(input.unit);

  let confidence = 0.1;
  if (component) confidence += 0.35;
  if (material) confidence += materialImplied ? 0.2 : 0.25;
  if (brand) confidence += 0.15;
  if (line) confidence += 0.15;
  if (unit.recognized) confidence += 0.1;
  if (costClass === "labor" && laborText) confidence += 0.2;
  if (classConflict) confidence -= 0.25;
  // Without a component the item is only usable for coarse trade-level labor packages, never precise comparisons.
  if (!component) confidence = Math.min(confidence, costClass === "labor" ? 0.55 : 0.3);
  confidence = Math.max(0, Math.min(0.98, Math.round(confidence * 100) / 100));

  const category = component ? (material && costClass !== "labor" ? `${component}.${material}` : component) : "unclassified";
  let materialKey: string;
  if (costClass === "labor") {
    materialKey = `labor.${input.trade ?? "any"}.${component ?? "general"}`;
  } else {
    const parts = [category];
    if (brand) parts.push(slug(brand.name));
    if (brand && line) parts.push(slug(line.name));
    if (specs.nominal && component && ["decking", "framing", "stairs"].includes(component)) parts.push(String(specs.nominal));
    materialKey = parts.join(".");
  }

  return {
    fingerprint: fingerprintOf(input),
    trade: input.trade ?? null,
    component,
    material,
    category,
    brand: brand?.name ?? null,
    productLine: line?.name ?? null,
    specs,
    installType: installTypeOf(text),
    costClass,
    materialKey,
    confidence,
    method: "rule",
    classConflict,
  };
}

const LABELS: Record<string, string> = {
  tear_off: "Tear-off", underlayment: "Underlayment", flashing: "Flashing", ridge: "Ridge", shingles: "Shingles", metal_roofing: "Metal roofing",
  roof_sheathing: "Roof sheathing", railing: "Railing", stairs: "Stairs", footings: "Footings", fasteners: "Fasteners", decking: "Decking",
  framing: "Framing", countertops: "Countertops", backsplash: "Backsplash", cabinets: "Cabinets", appliances: "Appliances",
  sink_faucet: "Sink & faucet", toilet: "Toilet", shower_tub: "Shower & tub", vanity: "Vanity", water_heater: "Water heater", piping: "Piping",
  hvac_equipment: "HVAC equipment", ductwork: "Ductwork", electrical_panel: "Electrical panel", electrical_devices: "Electrical devices",
  flooring: "Flooring", tile: "Tile", drywall: "Drywall", paint: "Paint", siding: "Siding", gutters: "Gutters", windows: "Windows", doors: "Doors",
  fence: "Fence", concrete: "Concrete", asphalt: "Asphalt", insulation: "Insulation", masonry: "Masonry", excavation: "Excavation",
  landscaping: "Landscaping", demolition: "Demolition", permit: "Permit", cleanup: "Cleanup", labor: "Labor", general: "General",
  pvc: "PVC", composite: "Composite", pressure_treated: "Pressure-treated", cedar: "Cedar", redwood: "Redwood", tropical_hardwood: "Tropical hardwood",
  aluminum: "Aluminum", cable: "Cable", glass: "Glass", steel: "Steel", vinyl: "Vinyl", architectural_asphalt: "Architectural asphalt",
  three_tab_asphalt: "3-tab asphalt", synthetic: "Synthetic", felt: "Felt", ice_water: "Ice & water", quartz: "Quartz", granite: "Granite",
  marble: "Marble", laminate: "Laminate", butcher_block: "Butcher block", solid_surface: "Solid surface", fiber_cement: "Fiber cement",
  engineered_wood: "Engineered wood", lvp: "Luxury vinyl", hardwood: "Hardwood", carpet: "Carpet", porcelain: "Porcelain", ceramic: "Ceramic",
  stock: "Stock", semi_custom: "Semi-custom", custom: "Custom", chain_link: "Chain-link", wood: "Wood", fiberglass: "Fiberglass",
  mineral_wool: "Mineral wool", unclassified: "Unclassified",
};

/** Human label for a category or material key, e.g. "decking.composite.trex.enhance-basics" -> "Decking · Composite · trex · enhance-basics". */
export function labelForKey(key: string): string {
  return key.split(".").map((p) => LABELS[p] ?? p.replace(/-/g, " ")).join(" · ");
}
