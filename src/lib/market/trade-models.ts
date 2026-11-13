/**
 * Trade-specific project measurements. These turn a bid into a comparable project: a 400 SF
 * ground-level composite deck is compared with similar decks, never with an elevated deck with
 * stairs and 80 LF of railing.
 *
 * `primary` is the standardized project unit used for price-per-unit reporting. It is reported
 * only when the measurement is present (entered, or inferred from line items and marked so).
 */
export type Sector = "residential" | "commercial";
export type WorkType = "new_construction" | "remodel" | "addition" | "replacement" | "repair";
export type Outcome = "quoted" | "accepted" | "declined" | "completed";
export type Complexity = "standard" | "complex";

export interface ProjectProfile {
  sector?: Sector;
  workType?: WorkType;
  projectType?: string;
  measurements?: Record<string, number | string | boolean>;
  outcome?: Outcome;
}

export interface Option { value: string; label: string }
export interface MeasureField { key: string; label: string; type: "number" | "select" | "boolean"; unit?: string; options?: Option[] }

export interface TradeModel {
  trade: string;
  projectTypes: Option[];
  primary: { key: string; unit: "square foot" | "linear foot" | "square" | "each" | "ton"; label: string } | null;
  fields: MeasureField[];
  /** Line-item components whose quantity can stand in for the primary measurement when it isn't entered. */
  inferFrom?: { components: string[]; family: "area" | "length" | "count" };
  complexity: (m: Record<string, unknown>, projectType?: string) => Complexity | null;
  complexityRule: string;
}

const o = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));
const num = (key: string, label: string, unit?: string): MeasureField => ({ key, label, type: "number", unit });
const sel = (key: string, label: string, options: Option[]): MeasureField => ({ key, label, type: "select", options });
const bool = (key: string, label: string): MeasureField => ({ key, label, type: "boolean" });
const n = (m: Record<string, unknown>, k: string) => (typeof m[k] === "number" ? (m[k] as number) : Number(m[k] ?? NaN));

const STORIES = o(["1", "1 story"], ["2", "2 stories"], ["3", "3+ stories"]);
const WASH_SURFACES = o(["concrete", "Concrete"], ["pavers", "Pavers"], ["brick", "Brick"], ["stone", "Natural stone"], ["asphalt", "Asphalt"], ["wood", "Wood"], ["composite", "Composite"], ["vinyl", "Vinyl"], ["other", "Other"]);
const WASH_CONDITION = o(["light", "Light (dust, light mildew)"], ["moderate", "Moderate (algae, dirt)"], ["heavy", "Heavy buildup"], ["stains", "Oil, rust or other stains"]);

export const TRADE_MODELS: Record<string, TradeModel> = {
  decks: {
    trade: "decks",
    projectTypes: o(["new_deck", "New deck"], ["resurface", "Resurfacing (existing frame)"], ["repair", "Repair"], ["porch", "Porch"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Deck area" },
    fields: [
      num("area_sqft", "Deck area", "SF"), num("height_ft", "Deck height above grade", "ft"), num("railing_lf", "Railing", "LF"),
      num("stair_count", "Stair runs", "count"), num("footing_count", "Footings", "count"),
      sel("decking_material", "Decking material", o(["pressure_treated", "Pressure-treated"], ["composite", "Composite"], ["pvc", "PVC"], ["cedar", "Cedar"], ["tropical_hardwood", "Tropical hardwood"], ["other", "Other"])),
    ],
    inferFrom: { components: ["decking"], family: "area" },
    complexity: (m) => (n(m, "height_ft") >= 4 || n(m, "stair_count") >= 2 || n(m, "railing_lf") >= 40 ? "complex" : Number.isFinite(n(m, "height_ft")) || Number.isFinite(n(m, "railing_lf")) ? "standard" : null),
    complexityRule: "Complex = 4 ft or higher, 2+ stair runs, or 40+ LF of railing.",
  },
  roofing: {
    trade: "roofing",
    projectTypes: o(["replacement", "Full replacement"], ["overlay", "Overlay"], ["repair", "Repair"], ["new", "New roof"]),
    primary: { key: "squares", unit: "square", label: "Roof area" },
    fields: [
      num("squares", "Roof area", "squares"),
      sel("material", "Roofing material", o(["architectural_asphalt", "Architectural asphalt"], ["three_tab_asphalt", "3-tab asphalt"], ["metal", "Metal"], ["tile", "Tile"], ["slate", "Slate"], ["flat_membrane", "Flat / membrane"])),
      num("layers_removed", "Layers removed", "count"),
      sel("pitch", "Roof pitch", o(["low", "Low (up to 4/12)"], ["medium", "Medium (5/12 to 8/12)"], ["steep", "Steep (9/12+)"])),
      sel("access", "Accessibility", o(["easy", "Easy"], ["moderate", "Moderate"], ["difficult", "Difficult"])),
      sel("underlayment", "Underlayment", o(["felt", "Felt"], ["synthetic", "Synthetic"], ["ice_water_full", "Full ice & water"])),
      bool("flashing_replaced", "Flashing replaced"), sel("stories", "Stories", STORIES),
    ],
    inferFrom: { components: ["shingles", "metal_roofing"], family: "area" },
    complexity: (m) => (m.pitch === "steep" || n(m, "layers_removed") >= 2 || m.access === "difficult" || n(m, "stories") >= 3 ? "complex" : m.pitch || m.access ? "standard" : null),
    complexityRule: "Complex = steep pitch, 2+ layers removed, difficult access, or 3+ stories.",
  },
  kitchens: {
    trade: "kitchens",
    projectTypes: o(["full_remodel", "Full remodel"], ["partial", "Partial remodel"], ["refresh", "Cosmetic refresh"], ["new", "New kitchen"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Kitchen area" },
    fields: [
      num("area_sqft", "Kitchen area", "SF"),
      sel("cabinetry", "Cabinetry", o(["stock", "Stock"], ["semi_custom", "Semi-custom"], ["custom", "Custom"], ["refacing", "Refacing"], ["none", "None"])),
      sel("countertop", "Countertop", o(["laminate", "Laminate"], ["quartz", "Quartz"], ["granite", "Granite"], ["marble", "Marble"], ["butcher_block", "Butcher block"], ["solid_surface", "Solid surface"], ["none", "None"])),
      sel("layout", "Layout", o(["galley", "Galley"], ["l_shape", "L-shape"], ["u_shape", "U-shape"], ["island", "With island"], ["other", "Other"])),
      bool("layout_change", "Layout changes"), bool("flooring_included", "Flooring included"), bool("appliances_included", "Appliances included"),
      sel("electrical", "Electrical scope", o(["none", "None"], ["minor", "Minor"], ["major", "Major / new circuits"])),
      sel("plumbing", "Plumbing scope", o(["none", "None"], ["minor", "Fixture swap"], ["relocation", "Relocation"])),
      bool("demolition", "Demolition included"),
    ],
    complexity: (m) => (m.layout_change === true || m.plumbing === "relocation" || m.electrical === "major" || m.cabinetry === "custom" ? "complex" : m.cabinetry || m.plumbing || m.electrical ? "standard" : null),
    complexityRule: "Complex = layout change, plumbing relocation, major electrical, or custom cabinetry.",
  },
  bathrooms: {
    trade: "bathrooms",
    projectTypes: o(["full_remodel", "Full remodel"], ["partial", "Partial remodel"], ["tub_to_shower", "Tub-to-shower"], ["new", "New bathroom"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Bathroom area" },
    fields: [num("area_sqft", "Bathroom area", "SF"), num("tile_sqft", "Tile area", "SF"), num("fixture_count", "Fixtures replaced", "count"), bool("layout_change", "Layout changes"), sel("shower", "Shower", o(["none", "None"], ["prefab", "Prefab / surround"], ["tile", "Custom tile"]))],
    complexity: (m) => (m.layout_change === true || m.shower === "tile" ? "complex" : m.shower ? "standard" : null),
    complexityRule: "Complex = layout change or custom tile shower.",
  },
  siding: {
    trade: "siding",
    projectTypes: o(["replacement", "Replacement"], ["new", "New construction"], ["repair", "Repair"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Wall area" },
    fields: [num("area_sqft", "Wall area", "SF"), sel("material", "Material", o(["vinyl", "Vinyl"], ["fiber_cement", "Fiber cement"], ["engineered_wood", "Engineered wood"], ["wood", "Wood"], ["metal", "Metal"])), bool("removal", "Old siding removed"), sel("stories", "Stories", STORIES)],
    inferFrom: { components: ["siding"], family: "area" },
    complexity: (m) => (n(m, "stories") >= 3 ? "complex" : m.stories ? "standard" : null),
    complexityRule: "Complex = 3+ stories.",
  },
  concrete: {
    trade: "concrete",
    projectTypes: o(["driveway", "Driveway"], ["patio", "Patio"], ["sidewalk", "Sidewalk"], ["slab", "Slab"], ["steps", "Steps"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Flatwork area" },
    fields: [num("area_sqft", "Area", "SF"), num("thickness_in", "Thickness", "in"), bool("demolition", "Removal of existing"), sel("finish", "Finish", o(["broom", "Broom"], ["stamped", "Stamped"], ["exposed", "Exposed aggregate"], ["smooth", "Smooth / trowel"]))],
    inferFrom: { components: ["concrete"], family: "area" },
    complexity: (m) => (n(m, "thickness_in") >= 6 || m.finish === "stamped" || m.demolition === true ? "complex" : m.finish || m.thickness_in ? "standard" : null),
    complexityRule: "Complex = 6 in or thicker, stamped finish, or removal of existing concrete.",
  },
  painting: {
    trade: "painting",
    projectTypes: o(["interior", "Interior"], ["exterior", "Exterior"], ["cabinets", "Cabinets"], ["commercial", "Commercial"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Paintable area" },
    fields: [num("area_sqft", "Paintable area", "SF"), num("coats", "Coats", "count"), sel("prep", "Prep level", o(["light", "Light"], ["moderate", "Moderate"], ["heavy", "Heavy (scraping, repairs)"])), sel("stories", "Stories", STORIES)],
    inferFrom: { components: ["paint"], family: "area" },
    complexity: (m) => (m.prep === "heavy" || n(m, "stories") >= 2 ? "complex" : m.prep ? "standard" : null),
    complexityRule: "Complex = heavy prep or 2+ stories.",
  },
  flooring: {
    trade: "flooring",
    projectTypes: o(["install", "New install"], ["replacement", "Replacement"], ["refinish", "Refinish"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Floor area" },
    fields: [num("area_sqft", "Floor area", "SF"), sel("material", "Material", o(["lvp", "Luxury vinyl"], ["hardwood", "Hardwood"], ["engineered", "Engineered wood"], ["laminate", "Laminate"], ["carpet", "Carpet"], ["tile", "Tile"])), bool("removal", "Old flooring removed"), bool("subfloor", "Subfloor work")],
    inferFrom: { components: ["flooring"], family: "area" },
    complexity: (m) => (m.subfloor === true ? "complex" : m.material ? "standard" : null),
    complexityRule: "Complex = subfloor work included.",
  },
  tile: {
    trade: "tile",
    projectTypes: o(["floor", "Floor"], ["wall", "Wall / backsplash"], ["shower", "Shower"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Tile area" },
    fields: [num("area_sqft", "Tile area", "SF"), sel("tile_size", "Tile size", o(["small", "Mosaic / small"], ["standard", "Standard"], ["large", "Large format (24 in+)"])), bool("removal", "Removal of existing")],
    inferFrom: { components: ["tile"], family: "area" },
    complexity: (m, t) => (m.tile_size === "large" || m.tile_size === "small" || t === "shower" ? "complex" : m.tile_size ? "standard" : null),
    complexityRule: "Complex = mosaic or large-format tile, or showers.",
  },
  fencing: {
    trade: "fencing",
    projectTypes: o(["new", "New fence"], ["replacement", "Replacement"], ["repair", "Repair"]),
    primary: { key: "length_lf", unit: "linear foot", label: "Fence length" },
    fields: [num("length_lf", "Fence length", "LF"), num("height_ft", "Height", "ft"), num("gate_count", "Gates", "count"), sel("material", "Material", o(["wood", "Wood"], ["vinyl", "Vinyl"], ["chain_link", "Chain-link"], ["aluminum", "Aluminum"], ["composite", "Composite"])), bool("removal", "Old fence removed")],
    inferFrom: { components: ["fence"], family: "length" },
    complexity: (m) => (n(m, "height_ft") >= 6 ? "complex" : Number.isFinite(n(m, "height_ft")) ? "standard" : null),
    complexityRule: "Complex = 6 ft or taller.",
  },
  "windows-doors": {
    trade: "windows-doors",
    projectTypes: o(["windows", "Windows"], ["entry_doors", "Entry doors"], ["patio_doors", "Patio doors"], ["mixed", "Mixed"]),
    primary: { key: "unit_count", unit: "each", label: "Units installed" },
    fields: [num("unit_count", "Units installed", "count"), sel("install", "Install type", o(["insert", "Insert / pocket"], ["full_frame", "Full-frame"], ["new_opening", "New opening"]))],
    inferFrom: { components: ["windows", "doors"], family: "count" },
    complexity: (m) => (m.install === "full_frame" || m.install === "new_opening" ? "complex" : m.install ? "standard" : null),
    complexityRule: "Complex = full-frame install or new openings.",
  },
  hvac: {
    trade: "hvac",
    projectTypes: o(["replacement", "System replacement"], ["new", "New system"], ["mini_split", "Mini-split"], ["repair", "Repair"]),
    primary: { key: "tons", unit: "ton", label: "System capacity" },
    fields: [num("tons", "System capacity", "tons"), sel("system", "System", o(["furnace_ac", "Furnace + AC"], ["heat_pump", "Heat pump"], ["mini_split", "Mini-split"], ["boiler", "Boiler"])), sel("ductwork", "Ductwork", o(["none", "None"], ["partial", "Partial"], ["full", "Full"]))],
    complexity: (m) => (m.ductwork === "full" ? "complex" : m.ductwork ? "standard" : null),
    complexityRule: "Complex = full new ductwork.",
  },
  electrical: {
    trade: "electrical",
    projectTypes: o(["panel_upgrade", "Panel / service upgrade"], ["rewire", "Rewire"], ["remodel", "Remodel wiring"], ["fixtures", "Fixtures & devices"], ["ev_charger", "EV charger"]),
    primary: null,
    fields: [num("service_amps", "Service size", "amps"), num("circuits", "New circuits", "count"), num("device_count", "Devices / fixtures", "count")],
    complexity: (m, t) => (t === "rewire" || n(m, "service_amps") >= 400 ? "complex" : t ? "standard" : null),
    complexityRule: "Complex = whole-house rewire or 400 A+ service.",
  },
  plumbing: {
    trade: "plumbing",
    projectTypes: o(["repipe", "Repipe"], ["fixtures", "Fixtures"], ["water_heater", "Water heater"], ["remodel", "Remodel rough-in"], ["sewer", "Sewer / drain"]),
    primary: null,
    fields: [num("fixture_count", "Fixtures", "count"), bool("relocation", "Fixture relocation")],
    complexity: (m, t) => (t === "repipe" || m.relocation === true ? "complex" : t ? "standard" : null),
    complexityRule: "Complex = repipe or fixture relocation.",
  },
  drywall: {
    trade: "drywall",
    projectTypes: o(["new", "New hang & finish"], ["repair", "Repair"], ["finish_only", "Finish only"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Board area" },
    fields: [num("area_sqft", "Board area", "SF"), sel("finish_level", "Finish level", o(["3", "Level 3"], ["4", "Level 4"], ["5", "Level 5"])), bool("ceilings", "Includes ceilings")],
    inferFrom: { components: ["drywall"], family: "area" },
    complexity: (m) => (m.finish_level === "5" ? "complex" : m.finish_level ? "standard" : null),
    complexityRule: "Complex = level 5 finish.",
  },
  gutters: {
    trade: "gutters",
    projectTypes: o(["new", "New gutters"], ["replacement", "Replacement"], ["guards", "Guards only"]),
    primary: { key: "length_lf", unit: "linear foot", label: "Gutter length" },
    fields: [num("length_lf", "Gutter length", "LF"), sel("material", "Material", o(["aluminum", "Aluminum"], ["copper", "Copper"], ["steel", "Steel"], ["vinyl", "Vinyl"])), bool("guards", "Guards included"), sel("stories", "Stories", STORIES)],
    inferFrom: { components: ["gutters"], family: "length" },
    complexity: (m) => (n(m, "stories") >= 3 || m.material === "copper" ? "complex" : m.stories ? "standard" : null),
    complexityRule: "Complex = 3+ stories or copper.",
  },
  insulation: {
    trade: "insulation",
    projectTypes: o(["attic", "Attic"], ["walls", "Walls"], ["crawlspace", "Crawlspace"], ["spray_foam", "Spray foam"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Insulated area" },
    fields: [num("area_sqft", "Insulated area", "SF"), num("r_value", "Target R-value", "R")],
    inferFrom: { components: ["insulation"], family: "area" },
    complexity: () => null,
    complexityRule: "No complexity split yet.",
  },
  "asphalt-paving": {
    trade: "asphalt-paving",
    projectTypes: o(["new", "New paving"], ["overlay", "Overlay"], ["sealcoat", "Sealcoat"], ["repair", "Repair"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Paved area" },
    fields: [num("area_sqft", "Paved area", "SF"), num("thickness_in", "Thickness", "in")],
    inferFrom: { components: ["asphalt"], family: "area" },
    complexity: (m) => (n(m, "thickness_in") >= 4 ? "complex" : Number.isFinite(n(m, "thickness_in")) ? "standard" : null),
    complexityRule: "Complex = 4 in or thicker.",
  },
  basements: {
    trade: "basements",
    projectTypes: o(["finish", "Basement finish"], ["waterproofing", "Waterproofing"], ["remodel", "Remodel"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Finished area" },
    fields: [num("area_sqft", "Finished area", "SF"), bool("bathroom", "Includes bathroom"), bool("egress", "Egress window")],
    complexity: (m) => (m.bathroom === true || m.egress === true ? "complex" : m.area_sqft ? "standard" : null),
    complexityRule: "Complex = includes a bathroom or egress window.",
  },
  additions: {
    trade: "additions",
    projectTypes: o(["room", "Room addition"], ["second_story", "Second story"], ["sunroom", "Sunroom"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Added area" },
    fields: [num("area_sqft", "Added area", "SF"), sel("stories", "Stories", STORIES), bool("plumbing", "Includes plumbing")],
    complexity: (m, t) => (t === "second_story" || m.plumbing === true ? "complex" : t ? "standard" : null),
    complexityRule: "Complex = second story or includes plumbing.",
  },
  garages: {
    trade: "garages",
    projectTypes: o(["detached", "Detached garage"], ["attached", "Attached garage"], ["conversion", "Conversion"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Garage area" },
    fields: [num("area_sqft", "Garage area", "SF"), num("bays", "Bays", "count")],
    complexity: () => null,
    complexityRule: "No complexity split yet.",
  },
  "pressure-washing": {
    trade: "pressure-washing",
    projectTypes: o(["flatwork", "Driveway & flatwork"], ["patio_pavers", "Patio / pavers"], ["deck_fence", "Deck / fence"], ["mixed", "Multiple surfaces"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Cleaned area" },
    fields: [
      num("area_sqft", "Cleaned area", "SF"),
      sel("surface", "Main surface", WASH_SURFACES),
      sel("condition", "Condition / buildup", WASH_CONDITION),
      sel("access", "Accessibility", o(["easy", "Easy"], ["moderate", "Moderate"], ["difficult", "Difficult"])),
      bool("water_on_site", "Water available on site"),
    ],
    complexity: (m) => (m.condition === "heavy" || m.condition === "stains" || m.access === "difficult" ? "complex" : m.condition || m.access ? "standard" : null),
    complexityRule: "Complex = heavy buildup, stain treatment, or difficult access.",
  },
  "soft-washing": {
    trade: "soft-washing",
    projectTypes: o(["house_wash", "House wash"], ["roof_cleaning", "Roof cleaning"], ["house_and_roof", "House and roof"], ["commercial_exterior", "Commercial exterior"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Cleaned area" },
    fields: [
      num("area_sqft", "Cleaned area", "SF"),
      sel("material", "Main surface material", o(["vinyl", "Vinyl siding"], ["fiber_cement", "Fiber cement"], ["wood", "Wood"], ["stucco", "Stucco"], ["brick", "Brick"], ["stone", "Stone"], ["eifs", "EIFS"], ["painted", "Painted surface"], ["asphalt_shingle", "Asphalt shingle roof"], ["metal_roof", "Metal roof"], ["tile_roof", "Tile roof"], ["other", "Other"])),
      sel("stories", "Stories / working height", STORIES),
      sel("condition", "Condition / buildup", WASH_CONDITION),
      sel("access", "Access difficulty", o(["easy", "Easy"], ["moderate", "Moderate"], ["difficult", "Difficult"])),
      bool("roof_included", "Includes roof cleaning"),
    ],
    complexity: (m) => (n(m, "stories") >= 3 || m.access === "difficult" || m.roof_included === true ? "complex" : m.stories || m.access ? "standard" : null),
    complexityRule: "Complex = 3+ stories, difficult access, or roof cleaning included.",
  },
  landscaping: {
    trade: "landscaping",
    projectTypes: o(["install", "New install"], ["maintenance", "Maintenance"], ["hardscape", "Hardscape"]),
    primary: { key: "area_sqft", unit: "square foot", label: "Area" },
    fields: [num("area_sqft", "Area", "SF")],
    complexity: () => null,
    complexityRule: "No complexity split yet.",
  },
};

/** Trades without a dedicated model still record sector/work type and an optional project size. */
export const GENERIC_MODEL: TradeModel = {
  trade: "generic",
  projectTypes: [],
  primary: null,
  fields: [num("area_sqft", "Project size", "SF")],
  complexity: () => null,
  complexityRule: "No complexity split for this trade.",
};

export function tradeModel(trade: string | undefined | null): TradeModel {
  return (trade && TRADE_MODELS[trade]) || GENERIC_MODEL;
}

export const SECTORS: Option[] = o(["residential", "Residential"], ["commercial", "Commercial"]);
export const WORK_TYPES: Option[] = o(["new_construction", "New construction"], ["remodel", "Remodel / renovation"], ["addition", "Addition"], ["replacement", "Replacement"], ["repair", "Repair"]);
export const OUTCOMES: Option[] = o(["quoted", "Quoted (no decision yet)"], ["accepted", "Accepted"], ["declined", "Declined"], ["completed", "Completed"]);

/** Keep only fields the model defines, with the right types. Unknown keys are dropped (they could carry free text). */
export function sanitizeMeasurements(trade: string | null | undefined, raw: Record<string, unknown> | undefined): Record<string, number | string | boolean> {
  const model = tradeModel(trade);
  const out: Record<string, number | string | boolean> = {};
  if (!raw) return out;
  for (const f of model.fields) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "number") { const x = Number(v); if (Number.isFinite(x) && x >= 0 && x < 1e7) out[f.key] = x; }
    else if (f.type === "boolean") { if (typeof v === "boolean") out[f.key] = v; }
    else if (f.options?.some((op) => op.value === v)) out[f.key] = String(v);
  }
  return out;
}
