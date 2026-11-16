/**
 * Per-trade question banks for the bid check. Each bank asks which kind of work the contractor bids,
 * then what takes the longest to price (only the parts that exist on that kind of job), and carries
 * the example estimate used on the result screen.
 *
 * Example prices are illustrative only (clearly labelled wherever they are shown). They are never
 * used as pricing advice and never added to a contractor's real estimate unless they open the sample.
 */
import type { Goal, Option, SampleArea } from "./types";

export interface Job extends Option {
  /** Trade template to open (defaults to the bank's catalog slug). */
  templateSlug?: string;
  /** Sample estimate title. */
  title: string;
  /** Estimate sections for this kind of job, in order. Only these parts can be the pain point. */
  areas: string[];
  /** Quantities multiplied by this (rounded up) for smaller or larger jobs. */
  scale?: number;
  /** Replacement areas for this kind of job (cabinet painting, bathrooms...). */
  overrides?: Record<string, SampleArea>;
  scope: string;
}

export interface Pain extends Option {
  /** Estimate section that holds this part of the job. */
  area: string;
  /** Kinds of work where this question makes no sense (tear-off on new construction). */
  skipJobs?: string[];
  /** Short noun phrase for result copy ("stairs", "prep and repairs"). */
  noun: string;
  /** What gets broken out on the sample ("stringers, treads and stair labor"). */
  lines: string;
}

/** A follow-up that only exists for one trade + goal + pain combination. */
export interface Special {
  goal: Goal;
  pain: string;
  prompt: string;
  options: (Option & { tip: string })[];
}

export interface DeepQuestion { prompt: string; options: Option[]; jobs?: string[] }

export interface TradeBank {
  key: string;
  label: string;
  /** "deck", "paint job": used in result copy. */
  noun: string;
  catalogSlug: string;
  jobPrompt: string;
  jobs: Job[];
  painPrompt: string;
  pains: Pain[];
  areas: Record<string, SampleArea>;
  specials: Special[];
  /** Optional deeper-path question(s); the first whose jobs match is asked. */
  deep: DeepQuestion[];
}

const opt = (value: string, label: string, hint?: string): Option => (hint ? { value, label, hint } : { value, label });

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------
const decks: TradeBank = {
  key: "decks", label: "Decks", noun: "deck", catalogSlug: "decks",
  jobPrompt: "What kind of deck work do you bid most?",
  jobs: [
    { value: "new", label: "New builds", title: "New 16 × 20 composite deck", areas: ["footings", "decking", "stairs", "railings"], scope: "Build a new 16 × 20 ft composite deck on new footings and pressure-treated framing, with one set of stairs and aluminum railings." },
    { value: "replacement", label: "Tear-off and replace", title: "Deck replacement, 16 × 20", areas: ["demo", "footings", "decking", "stairs", "railings"], scope: "Remove the existing deck and build a new 16 × 20 ft composite deck on new footings and framing, with stairs and railings." },
    { value: "resurfacing", label: "Resurfacing (keep the framing)", title: "Deck resurfacing, 16 × 20", areas: ["teardown", "decking", "stairs", "railings"], scope: "Remove the old deck boards and railings, repair the existing framing as needed, and install new composite decking, stair treads and railings." },
  ],
  painPrompt: "What takes the longest to price on a deck?",
  pains: [
    { value: "footings", label: "Footings and framing", area: "footings", skipJobs: ["resurfacing"], noun: "footings and framing", lines: "footings, posts, beams, joists and framing labor" },
    { value: "decking", label: "Decking", area: "decking", noun: "decking", lines: "boards, fasteners, fascia and install labor" },
    { value: "stairs", label: "Stairs", area: "stairs", noun: "stairs", lines: "stringers, treads, risers and stair labor" },
    { value: "railings", label: "Railings", area: "railings", noun: "railings", lines: "railing sections, posts, caps and install labor" },
  ],
  areas: {
    demo: { group: "Demolition", detail: [["Remove existing deck", "lump sum", "labor", 1, 950], ["Dumpster and haul-away", "each", "equipment", 1, 450]], pkg: [["Demolition and haul-away", "lump sum", "labor", 1, 1400]] },
    teardown: { group: "Tear-Off & Framing Repairs", detail: [["Remove old deck boards and railings", "lump sum", "labor", 1, 650], ["Framing inspection and repairs", "hour", "labor", 6, 62], ["Joist tape and sister lumber", "lump sum", "material", 1, 180]], pkg: [["Tear-off and framing repairs", "lump sum", "labor_material", 1, 1200]] },
    footings: {
      group: "Footings & Framing",
      detail: [["Concrete footings", "each", "material", 9, 38], ["Post bases", "each", "material", 9, 24], ["Footing excavation", "each", "labor", 9, 85], ["Pressure-treated posts (6×6)", "each", "material", 9, 42], ["Beams and joists", "lump sum", "material", 1, 1650], ["Joist hangers and connectors", "lump sum", "material", 1, 260], ["Framing labor", "hour", "labor", 32, 62]],
      pkg: [["Footings and framing (labor and materials)", "lump sum", "labor_material", 1, 4900]],
    },
    decking: {
      group: "Decking",
      detail: [["Composite deck boards", "each", "material", 96, 42], ["Hidden fasteners", "box", "material", 12, 38], ["Fascia boards", "each", "material", 8, 55], ["Decking installation", "square foot", "labor", 320, 4.5]],
      pkg: [["Decking package (labor and materials)", "lump sum", "labor_material", 1, 6100]],
    },
    stairs: {
      group: "Stairs",
      detail: [["Stair stringers", "each", "material", 4, 48], ["Stair treads (composite)", "each", "material", 12, 42], ["Riser boards", "each", "material", 6, 55], ["Landing pad", "each", "material", 1, 180], ["Stair framing and install labor", "hour", "labor", 12, 62]],
      pkg: [["Stairs, 4 steps (labor and materials)", "lump sum", "labor_material", 1, 1650]],
    },
    railings: {
      group: "Railings",
      detail: [["Aluminum railing sections", "linear foot", "material", 52, 38], ["Railing posts", "each", "material", 14, 45], ["Post caps", "each", "material", 14, 12], ["Railing installation", "linear foot", "labor", 52, 14]],
      pkg: [["Railing package (labor and materials)", "linear foot", "labor_material", 52, 75]],
    },
  },
  specials: [
    { goal: "profit", pain: "stairs", prompt: "How do you price stairs today?", options: [
      { value: "package", label: "One package price", tip: "Keep quoting stairs as one price if you like, but build it from stringers, treads and labor underneath. Then you'll see whether a 4-step stair actually pays." },
      { value: "split", label: "Separate labor and materials", tip: "You already split them. Put a markup on each line and compare the stair section's profit to the decking section's before you send." },
      { value: "per_step", label: "A price per step", tip: "Check your per-step price against real stringer, tread and labor costs once. If tall or wide stairs lose money, it'll show up right away." },
      { value: "guess", label: "Rough guess", tip: "Price one stair set line by line. Most builders find stairs eat more labor hours than they guessed." },
    ] },
    { goal: "speed", pain: "footings", prompt: "What slows down footings and framing?", options: [
      { value: "count", label: "Working out footing count and size", tip: "Use the quantity calculator beside Qty to turn deck size and spacing into a footing count, then confirm it against your plan." },
      { value: "sizing", label: "Beam and joist sizing", tip: "Keep your usual joist spacing and beam sizes as saved lines, so you only change lengths and counts per job." },
      { value: "list", label: "Building the lumber list", tip: "Save your framing package once (posts, beams, joists, hangers) and copy it into each new deck." },
    ] },
    { goal: "proposals", pain: "railings", prompt: "What do customers ask about railings?", options: [
      { value: "options", label: "Style and material options", tip: "Show railings as their own section with item names, so a customer can see what changes if they upgrade." },
      { value: "per_foot", label: "Why it costs that per foot", tip: "Show railings itemized: sections, posts and labor. The per-foot price makes sense once they see what's in it." },
      { value: "code", label: "Height and code questions", tip: "Add a line to your scope stating rail height and baluster spacing, so it's in writing before they sign." },
    ] },
  ],
  deep: [{ prompt: "Which decking do you install most?", options: [opt("composite", "Composite or PVC"), opt("pt", "Pressure-treated wood"), opt("hardwood", "Cedar or hardwood"), opt("mix", "A mix")] }],
};

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------
const paintingCabinets: Record<string, SampleArea> = {
  prep: { group: "Prep & Repairs", detail: [["Remove doors and hardware, label", "hour", "labor", 4, 55], ["Degrease and scuff-sand", "hour", "labor", 10, 55], ["Fill grain, holes and dings", "lump sum", "material", 1, 90], ["Mask and protect kitchen", "lump sum", "material", 1, 150]], pkg: [["Cabinet prep", "lump sum", "labor_material", 1, 1100]] },
  labor: { group: "Painting Labor", detail: [["Spray doors and drawer fronts", "each", "labor", 32, 45], ["Brush and roll cabinet boxes", "linear foot", "labor", 18, 38], ["Reinstall and adjust doors", "hour", "labor", 4, 55]], pkg: [["Cabinet painting labor", "lump sum", "labor", 1, 2350]] },
  materials: { group: "Paint & Materials", detail: [["Bonding primer", "gallon", "material", 2, 65], ["Cabinet enamel (2 coats)", "gallon", "material", 3, 85], ["Sandpaper, tape and supplies", "lump sum", "material", 1, 120]], pkg: [["Primer, enamel and supplies", "lump sum", "material", 1, 520]] },
};
const painting: TradeBank = {
  key: "painting", label: "Painting", noun: "paint job", catalogSlug: "painting",
  jobPrompt: "What kind of painting do you bid most?",
  jobs: [
    { value: "interior", label: "Interior", title: "Interior repaint, 3 bedrooms + hall", areas: ["prep", "labor", "materials", "access"], scope: "Prep and paint walls, ceilings and trim in three bedrooms and the hallway. Two finish coats on walls." },
    { value: "exterior", label: "Exterior", title: "Exterior repaint with trim", areas: ["prep", "labor", "materials", "access"], scope: "Wash, scrape, repair and prime as needed, then two coats on siding and one on trim, fascia and doors.",
      overrides: { labor: { group: "Painting Labor", detail: [["Siding, two coats", "square foot", "labor", 2200, 1.25], ["Trim and fascia", "linear foot", "labor", 380, 2.2], ["Doors and shutters", "each", "labor", 6, 65]], pkg: [["Exterior painting labor", "lump sum", "labor", 1, 3900]] } } },
    { value: "cabinets", label: "Cabinets", title: "Kitchen cabinet refinishing", areas: ["prep", "labor", "materials"], scope: "Remove, prep and spray-finish 32 doors and drawer fronts; brush and roll the boxes; reinstall and adjust.", overrides: paintingCabinets },
  ],
  painPrompt: "What takes the longest to price on a paint job?",
  pains: [
    { value: "prep", label: "Prep and repairs", area: "prep", noun: "prep and repairs", lines: "scraping, patching, caulking and masking" },
    { value: "labor", label: "Labor", area: "labor", noun: "painting labor", lines: "walls, ceilings and trim at their own rates" },
    { value: "materials", label: "Coats and materials", area: "materials", noun: "coats and materials", lines: "primer, finish coats and supplies by the gallon" },
    { value: "access", label: "Access (ladders, lifts, high walls)", area: "access", skipJobs: ["cabinets"], noun: "access", lines: "ladder setup, lift rental and protection" },
  ],
  areas: {
    prep: { group: "Prep & Repairs", detail: [["Scraping and sanding", "hour", "labor", 14, 48], ["Patch and minor repairs", "each", "labor", 8, 35], ["Caulking", "each", "material", 6, 9], ["Masking and protection", "lump sum", "material", 1, 120], ["Spot-prime repairs", "gallon", "material", 2, 38]], pkg: [["Prep and repairs", "lump sum", "labor_material", 1, 1100]] },
    labor: { group: "Painting Labor", detail: [["Walls, two coats", "square foot", "labor", 1800, 1.1], ["Ceilings", "square foot", "labor", 600, 0.9], ["Trim and doors", "linear foot", "labor", 420, 1.5]], pkg: [["Painting labor", "lump sum", "labor", 1, 3100]] },
    materials: { group: "Paint & Materials", detail: [["Primer", "gallon", "material", 4, 32], ["Wall paint (2 coats)", "gallon", "material", 12, 52], ["Trim paint", "gallon", "material", 3, 58], ["Supplies", "lump sum", "material", 1, 140]], pkg: [["Paint and materials", "lump sum", "material", 1, 1060]] },
    access: { group: "Access & Setup", detail: [["Ladder and plank setup", "hour", "labor", 4, 48], ["Lift rental", "day", "equipment", 1, 320], ["Drop cloths and plastic", "lump sum", "material", 1, 90]], pkg: [["Access and setup", "lump sum", "equipment", 1, 600]] },
  },
  specials: [
    { goal: "speed", pain: "prep", prompt: "When you price prep, where does the time go?", options: [
      { value: "measuring", label: "Measuring the surfaces", tip: "Measure once, then use the calculator beside Qty to turn wall sizes into square feet for prep and paint together." },
      { value: "repairs", label: "Estimating repairs", tip: "Price repairs per patch or per hour as saved lines, so a walkthrough count becomes a price in seconds." },
      { value: "scope", label: "Writing the prep scope", tip: "Keep your standard prep wording in the scope of work, and only edit what's different on this house." },
    ] },
    { goal: "profit", pain: "labor", prompt: "How do you figure painting labor?", options: [
      { value: "rates", label: "Production rates per square foot", tip: "Enter walls, ceilings and trim at their own rates. The margin shows per section, so a slow trim package stands out." },
      { value: "hours", label: "Hours per room", tip: "Price labor in hours, then check the margin. If your hourly rate doesn't cover overhead, you'll see it before sending." },
      { value: "day", label: "A day rate", tip: "Use crew days as the unit and let Built2Bid show the profit on each day you're quoting." },
      { value: "feel", label: "Gut feel", tip: "Write your number down, then enter the real labor and paint costs. The gap between them is your actual margin." },
    ] },
    { goal: "proposals", pain: "materials", prompt: "What do customers ask about paint?", options: [
      { value: "brand", label: "Brand and sheen", tip: "Name the product and sheen on the paint lines and show that section with item names." },
      { value: "coats", label: "How many coats", tip: "Put the coat count in the line names (\"Walls, two coats\") so it's on the proposal, not just in your head." },
      { value: "supply", label: "Who supplies the paint", tip: "Show paint as its own section. If they supply it, delete that section and the price updates." },
      { value: "colors", label: "Colors and changes", tip: "Add a line to your scope about color changes after the start date, so the answer is in writing." },
    ] },
  ],
  deep: [
    { prompt: "How do you spray or finish cabinets?", jobs: ["cabinets"], options: [opt("spray", "Spray everything"), opt("mixed", "Spray doors, brush boxes"), opt("brush", "Brush and roll"), opt("sub", "I sub it out")] },
    { prompt: "How do you usually quote a paint job?", options: [opt("sqft", "Per square foot"), opt("room", "Per room"), opt("hourly", "Hourly or day rate"), opt("lump", "One lump sum")] },
  ],
};

// ---------------------------------------------------------------------------
// Roofing
// ---------------------------------------------------------------------------
const roofing: TradeBank = {
  key: "roofing", label: "Roofing", noun: "roof", catalogSlug: "roofing",
  jobPrompt: "What kind of roofing work do you bid most?",
  jobs: [
    { value: "replacement", label: "Replacements", title: "Roof replacement, 24 squares", areas: ["tearoff", "decking", "materials", "pitch", "install"], scope: "Tear off one layer of shingles, replace damaged decking as needed, and install synthetic underlayment, ice and water shield and architectural shingles with new ridge vent." },
    { value: "repair", label: "Repairs", title: "Storm-damage roof repair", areas: ["tearoff", "decking", "materials", "install"], scale: 0.15, scope: "Remove damaged shingles on the rear slope, replace damaged decking, and install matching shingles with new flashing." },
    { value: "new", label: "New construction", title: "New-construction roof, 24 squares", areas: ["materials", "pitch", "install"], scope: "Install underlayment, ice and water shield, drip edge and architectural shingles on new decking supplied by the framer." },
  ],
  painPrompt: "What takes the longest to price on a roof?",
  pains: [
    { value: "tearoff", label: "Tear-off and disposal", area: "tearoff", skipJobs: ["new"], noun: "tear-off and disposal", lines: "tear-off labor, extra layers and dumpsters" },
    { value: "pitch", label: "Pitch and access", area: "pitch", noun: "pitch and access", lines: "steep-pitch labor, roof jacks and safety setup" },
    { value: "decking", label: "Decking repairs", area: "decking", skipJobs: ["new"], noun: "decking repairs", lines: "a per-sheet decking allowance with labor" },
    { value: "materials", label: "Materials", area: "materials", noun: "roofing materials", lines: "shingles, underlayment, flashing and vents" },
  ],
  areas: {
    tearoff: { group: "Tear-Off & Disposal", detail: [["Tear-off, one layer", "square", "labor", 24, 65], ["Dumpster", "each", "equipment", 2, 475], ["Protect landscaping and cleanup", "lump sum", "labor", 1, 150]], pkg: [["Tear-off and disposal", "square", "labor", 24, 110]] },
    pitch: { group: "Pitch & Access", detail: [["Steep-pitch labor (8/12 and up)", "square", "labor", 10, 35], ["Roof jacks and planks", "lump sum", "equipment", 1, 180], ["Fall protection setup", "hour", "labor", 4, 65]], pkg: [["Steep roof and access", "lump sum", "labor", 1, 790]] },
    decking: { group: "Decking Repairs", detail: [["Replace damaged decking (allowance)", "sheet", "material", 6, 38], ["Decking replacement labor", "sheet", "labor", 6, 45]], pkg: [["Decking repair allowance", "sheet", "labor_material", 6, 83]] },
    materials: { group: "Roofing Materials", detail: [["Architectural shingles", "square", "material", 26.5, 128], ["Synthetic underlayment", "roll", "material", 7, 95], ["Ice and water shield", "roll", "material", 4, 120], ["Drip edge", "linear foot", "material", 210, 1.6], ["Starter and ridge cap", "bundle", "material", 8, 55], ["Ridge vent", "linear foot", "material", 40, 6], ["Pipe boots and nails", "lump sum", "material", 1, 230]], pkg: [["Roofing materials package", "lump sum", "material", 1, 6900]] },
    install: { group: "Installation", detail: [["Shingle installation labor", "square", "labor", 24, 85], ["Flashing and detail work", "hour", "labor", 6, 70]], pkg: [["Installation labor", "lump sum", "labor", 1, 2460]] },
  },
  specials: [
    { goal: "profit", pain: "decking", prompt: "How do you handle decking damage you can't see yet?", options: [
      { value: "per_sheet", label: "A per-sheet price in the bid", tip: "Show a per-sheet decking line with a small allowance quantity. The margin is visible either way, and extra sheets are already priced." },
      { value: "contingency", label: "A contingency", tip: "Keep the contingency as its own line so you can see how much profit depends on not using it." },
      { value: "change_order", label: "A change order later", tip: "Add the per-sheet price to the bid anyway. Customers accept a change order more easily when the price was in writing." },
      { value: "absorb", label: "I usually eat it", tip: "Add a decking allowance line and look at the profit with and without it. That's what you've been giving away." },
    ] },
    { goal: "speed", pain: "pitch", prompt: "What slows down pricing pitch and access?", options: [
      { value: "planes", label: "Measuring roof planes", tip: "Use the roof calculator beside Qty to add planes and pitch, and apply the squares straight to your lines." },
      { value: "rates", label: "Steep-pitch labor rates", tip: "Save a steep-pitch add-on per square as its own line, so you only change the count." },
      { value: "setup", label: "Staging and safety setup", tip: "Keep a standard access and safety package you can copy into every roof." },
    ] },
  ],
  deep: [
    { prompt: "How many layers do you usually tear off?", jobs: ["replacement", "repair"], options: [opt("one", "One"), opt("two", "Two"), opt("varies", "It varies a lot")] },
    { prompt: "Which roofing do you install most?", options: [opt("asphalt", "Asphalt shingles"), opt("metal", "Metal"), opt("flat", "Flat or low-slope"), opt("mix", "A mix")] },
  ],
};

// ---------------------------------------------------------------------------
// Siding
// ---------------------------------------------------------------------------
const siding: TradeBank = {
  key: "siding", label: "Siding", noun: "siding job", catalogSlug: "siding",
  jobPrompt: "What kind of siding work do you bid most?",
  jobs: [
    { value: "full", label: "Full replacements", title: "Vinyl siding replacement, 22 squares", areas: ["tearoff", "wrap", "walls", "trim"], scope: "Remove existing siding, install new house wrap and vinyl siding with new corners, soffit and fascia wrap." },
    { value: "repair", label: "Repairs", title: "Siding repair after storm damage", areas: ["tearoff", "wrap", "walls", "trim"], scale: 0.2, scope: "Remove damaged siding on the west wall, patch house wrap, and install matching siding and trim." },
    { value: "new", label: "New construction", title: "New-construction siding, 22 squares", areas: ["wrap", "walls", "trim"], scope: "Install house wrap, siding, corners, soffit and fascia on new construction." },
  ],
  painPrompt: "What takes the longest to price on a siding job?",
  pains: [
    { value: "tearoff", label: "Tear-off", area: "tearoff", skipJobs: ["new"], noun: "tear-off", lines: "removal labor and disposal" },
    { value: "walls", label: "Wall measurements and openings", area: "walls", noun: "walls and openings", lines: "siding squares, openings and J-channel" },
    { value: "trim", label: "Trim", area: "trim", noun: "trim", lines: "corners, soffit, fascia and trim labor" },
    { value: "wrap", label: "Housewrap", area: "wrap", noun: "housewrap", lines: "wrap rolls, tape and install labor" },
  ],
  areas: {
    tearoff: { group: "Removal", detail: [["Remove existing siding", "square", "labor", 22, 55], ["Dumpster", "each", "equipment", 1, 450]], pkg: [["Removal and disposal", "square", "labor", 22, 75]] },
    wrap: { group: "Housewrap", detail: [["House wrap", "roll", "material", 3, 185], ["Seam tape and cap nails", "lump sum", "material", 1, 95], ["Wrap installation", "square", "labor", 22, 18]], pkg: [["Housewrap (labor and materials)", "square", "labor_material", 22, 47]] },
    walls: { group: "Walls & Openings", detail: [["Siding panels (12% waste)", "square", "material", 25, 145], ["Siding installation", "square", "labor", 22, 120], ["Window and door openings", "each", "labor", 16, 45], ["J-channel", "piece", "material", 40, 9]], pkg: [["Siding package (labor and materials)", "square", "labor_material", 22, 300]] },
    trim: { group: "Trim & Soffit", detail: [["Outside corners", "piece", "material", 10, 32], ["Soffit", "square foot", "material", 260, 3.2], ["Fascia wrap", "linear foot", "material", 180, 2.4], ["Trim installation", "linear foot", "labor", 440, 3.5]], pkg: [["Trim and soffit package", "lump sum", "labor_material", 1, 3100]] },
  },
  specials: [
    { goal: "speed", pain: "walls", prompt: "Where does wall measuring slow you down?", options: [
      { value: "gables", label: "Gables", tip: "Use the siding calculator beside Qty: it adds walls and gables and subtracts openings for you." },
      { value: "openings", label: "Subtracting openings", tip: "Enter openings once in the calculator; the squares and the J-channel count come out together." },
      { value: "squares", label: "Converting to squares", tip: "Let the calculator convert square feet to squares with your waste factor, then apply it to the line." },
    ] },
    { goal: "proposals", pain: "trim", prompt: "What do customers ask about trim?", options: [
      { value: "included", label: "What's included", tip: "Show trim as its own section with item names: corners, soffit, fascia." },
      { value: "colors", label: "Colors and profiles", tip: "Name the trim color and profile in the line descriptions so it prints on the proposal." },
      { value: "price", label: "Why trim costs so much", tip: "Itemize the trim section. Linear feet and labor explain the price better than a lump sum." },
    ] },
  ],
  deep: [{ prompt: "Which siding do you install most?", options: [opt("vinyl", "Vinyl"), opt("fiber", "Fiber cement"), opt("engineered", "Engineered wood"), opt("mix", "A mix")] }],
};

// ---------------------------------------------------------------------------
// Concrete
// ---------------------------------------------------------------------------
const concrete: TradeBank = {
  key: "concrete", label: "Concrete", noun: "pour", catalogSlug: "concrete",
  jobPrompt: "What kind of concrete work do you bid most?",
  jobs: [
    { value: "flatwork", label: "Driveways and patios", title: "Driveway replacement, 24 × 30", areas: ["excavation", "forms", "volume", "finishing"], scope: "Remove and replace a 24 × 30 ft driveway: 4 in. stone base, #4 rebar at 18 in., 4 in. of 4,000 psi concrete with a broom finish." },
    { value: "slabs", label: "Slabs", title: "Garage slab, 24 × 30", areas: ["excavation", "forms", "volume", "finishing"], scope: "Prepare base and pour a 4 in. reinforced garage slab with control joints and a smooth trowel finish." },
    { value: "steps", label: "Steps and walls", title: "Front steps and short retaining wall", areas: ["excavation", "forms", "volume", "finishing"], scale: 0.35, scope: "Form and pour new front steps and a short retaining wall with rebar, with a broom finish on the treads." },
  ],
  painPrompt: "What takes the longest to price on a pour?",
  pains: [
    { value: "excavation", label: "Excavation and base", area: "excavation", noun: "excavation and base", lines: "digging, stone base, compaction and grading" },
    { value: "forms", label: "Forms and reinforcement", area: "forms", noun: "forms and reinforcement", lines: "form boards, rebar, chairs and form labor" },
    { value: "volume", label: "Concrete volume", area: "volume", noun: "concrete volume", lines: "yards, overage and pump or short-load fees" },
    { value: "finishing", label: "Finishing", area: "finishing", noun: "finishing", lines: "placing, finishing, joints and curing" },
  ],
  areas: {
    excavation: { group: "Excavation & Base", detail: [["Excavation", "cubic yard", "labor", 12, 45], ["Stone base, 4 in.", "ton", "material", 14, 32], ["Compaction equipment", "day", "equipment", 1, 140], ["Fine grading", "square foot", "labor", 720, 0.45]], pkg: [["Site prep and base", "lump sum", "labor_material", 1, 1600]] },
    forms: { group: "Forms & Reinforcement", detail: [["Form boards", "linear foot", "material", 108, 2.2], ["Rebar #4 at 18 in.", "linear foot", "material", 980, 0.85], ["Rebar chairs and ties", "lump sum", "material", 1, 60], ["Expansion joint", "linear foot", "material", 30, 1.4], ["Form setting labor", "hour", "labor", 10, 58]], pkg: [["Forms and reinforcement", "lump sum", "labor_material", 1, 1850]] },
    volume: { group: "Concrete", detail: [["Ready-mix, 4,000 psi", "cubic yard", "material", 9, 165], ["Overage allowance", "cubic yard", "material", 1, 165], ["Pump truck", "lump sum", "equipment", 1, 650]], pkg: [["Concrete and pump", "lump sum", "material", 1, 2350]] },
    finishing: { group: "Finishing", detail: [["Place and broom finish", "square foot", "labor", 720, 1.6], ["Control joints", "linear foot", "labor", 90, 1.2], ["Curing compound", "gallon", "material", 3, 28], ["Form removal and cleanup", "lump sum", "labor", 1, 250]], pkg: [["Placing and finishing", "square foot", "labor", 720, 2.2]] },
  },
  specials: [
    { goal: "profit", pain: "volume", prompt: "How do you cover concrete overage?", options: [
      { value: "percent", label: "A set waste percentage", tip: "Keep overage as its own line, so you can see what it costs you and whether your percentage holds up." },
      { value: "round", label: "Round up to the next yard", tip: "Show the rounded-up yard as an overage line. It's priced, marked up and visible instead of hidden." },
      { value: "fees", label: "Short-load and pump fees", tip: "Put pump and short-load fees on their own lines with markup; small pours lose money when these are buried." },
      { value: "eat", label: "I usually eat it", tip: "Add an overage line and compare the profit with and without it." },
    ] },
    { goal: "speed", pain: "volume", prompt: "What slows down figuring yards?", options: [
      { value: "math", label: "The math", tip: "Use the concrete calculator beside Qty: length, width and thickness in, cubic yards out." },
      { value: "shapes", label: "Odd shapes and steps", tip: "Add each section to the calculator separately; it totals the yards and keeps your inputs for later edits." },
      { value: "orders", label: "Matching it to the order", tip: "Round yards in the calculator to what you'll actually order, so the bid matches the supplier invoice." },
    ] },
  ],
  deep: [{ prompt: "How do you usually reinforce flatwork?", options: [opt("rebar", "Rebar"), opt("mesh", "Wire mesh"), opt("fiber", "Fiber"), opt("depends", "Depends on the job")] }],
};

// ---------------------------------------------------------------------------
// Remodeling (kitchens, bathrooms, larger renovations)
// ---------------------------------------------------------------------------
const bathAreas: Record<string, SampleArea> = {
  demo: { group: "Demolition", detail: [["Remove tub, tile and vanity", "lump sum", "labor", 1, 1100], ["Dumpster", "each", "equipment", 1, 450], ["Dust control and protection", "lump sum", "material", 1, 180]], pkg: [["Demolition", "lump sum", "labor", 1, 1730]] },
  subs: { group: "Subcontractors", detail: [["Plumbing (sub quote)", "lump sum", "subcontractor", 1, 3200], ["Electrical and fan (sub quote)", "lump sum", "subcontractor", 1, 1100], ["Shower glass (sub quote)", "lump sum", "subcontractor", 1, 1400]], pkg: [["Plumbing, electrical and glass (subs)", "lump sum", "subcontractor", 1, 5700]] },
  allowances: { group: "Allowances", detail: [["Vanity and top allowance", "lump sum", "material", 1, 1800], ["Tile allowance", "square foot", "material", 160, 9], ["Plumbing fixture allowance", "lump sum", "material", 1, 1500], ["Lighting and fan allowance", "lump sum", "material", 1, 450]], pkg: [["Selections allowance (vanity, tile, fixtures)", "lump sum", "material", 1, 5200]] },
  scope: { group: "Installation & Finish", detail: [["Shower pan and waterproofing", "lump sum", "labor", 1, 1400], ["Tile installation", "square foot", "labor", 160, 14], ["Vanity and fixture set", "lump sum", "labor", 1, 650], ["Paint, trim and cleanup", "lump sum", "labor", 1, 700]], pkg: [["Installation and finish labor", "lump sum", "labor", 1, 5000]] },
};
const remodeling: TradeBank = {
  key: "remodeling", label: "Remodeling", noun: "remodel", catalogSlug: "interior-remodeling",
  jobPrompt: "What kind of remodeling do you bid most?",
  jobs: [
    { value: "kitchens", label: "Kitchens", templateSlug: "kitchens", title: "Kitchen remodel", areas: ["demo", "subs", "allowances", "scope"], scope: "Remove existing cabinets, counters and flooring. Install new cabinets, quartz countertops, tile backsplash, flooring and lighting. Selections per the allowances below." },
    { value: "bathrooms", label: "Bathrooms", templateSlug: "bathrooms", title: "Hall bathroom remodel", areas: ["demo", "subs", "allowances", "scope"], overrides: bathAreas, scope: "Gut the hall bath to the studs. New shower with tile walls and glass, vanity, toilet, fan and lighting. Selections per the allowances below." },
    { value: "renovations", label: "Larger renovations", templateSlug: "interior-remodeling", title: "Kitchen and main-floor renovation", areas: ["demo", "subs", "allowances", "scope"], scale: 1.6, scope: "Renovate the kitchen and open the main floor: demolition, new cabinets and counters, flooring throughout, lighting and paint. Selections per the allowances below." },
  ],
  painPrompt: "What takes the longest to price on a remodel?",
  pains: [
    { value: "demo", label: "Demo", area: "demo", noun: "demo", lines: "removal labor, dumpsters and protection" },
    { value: "subs", label: "Subcontractor quotes", area: "subs", noun: "subcontractor quotes", lines: "each sub quote on its own line with your markup" },
    { value: "allowances", label: "Allowances", area: "allowances", noun: "allowances", lines: "an allowance per selection: cabinets, tile, fixtures, lighting" },
    { value: "scope", label: "Writing scope and exclusions", area: "scope", noun: "scope and exclusions", lines: "install and finish work with a written scope" },
  ],
  areas: {
    demo: { group: "Demolition", detail: [["Remove cabinets, counters and flooring", "lump sum", "labor", 1, 1800], ["Dumpster", "each", "equipment", 1, 550], ["Dust control and protection", "lump sum", "material", 1, 300]], pkg: [["Demolition", "lump sum", "labor", 1, 2650]] },
    subs: { group: "Subcontractors", detail: [["Plumbing (sub quote)", "lump sum", "subcontractor", 1, 2400], ["Electrical (sub quote)", "lump sum", "subcontractor", 1, 3100], ["Countertop fabrication and install (sub quote)", "square foot", "subcontractor", 52, 72]], pkg: [["Plumbing, electrical and countertops (subs)", "lump sum", "subcontractor", 1, 9250]] },
    allowances: { group: "Allowances", detail: [["Cabinet allowance", "lump sum", "material", 1, 12000], ["Backsplash tile allowance", "square foot", "material", 30, 18], ["Plumbing fixture allowance", "lump sum", "material", 1, 1400], ["Lighting fixture allowance", "lump sum", "material", 1, 900], ["Flooring allowance", "square foot", "material", 180, 6]], pkg: [["Selections allowance (cabinets, fixtures, finishes)", "lump sum", "material", 1, 16000]] },
    scope: { group: "Installation & Finish", detail: [["Cabinet installation", "each", "labor", 22, 85], ["Backsplash installation", "square foot", "labor", 30, 16], ["Flooring installation", "square foot", "labor", 180, 4], ["Paint and patch", "lump sum", "labor", 1, 850], ["Final cleanup", "lump sum", "labor", 1, 300]], pkg: [["Installation and finish labor", "lump sum", "labor", 1, 4300]] },
  },
  specials: [
    { goal: "proposals", pain: "allowances", prompt: "Which selection do customers most often misunderstand?", options: [
      { value: "cabinets", label: "Cabinets", tip: "Give cabinets their own allowance line and say in the scope what happens if their pick costs more or less." },
      { value: "countertops", label: "Countertops", tip: "State the countertop allowance per square foot and what edge and cutouts it includes." },
      { value: "tile", label: "Tile", tip: "Write the tile allowance per square foot and note that pattern and size can change install labor." },
      { value: "fixtures", label: "Plumbing fixtures and lighting", tip: "List fixture and lighting allowances separately so customers see exactly what each one covers." },
    ] },
    { goal: "speed", pain: "subs", prompt: "What slows down sub quotes?", options: [
      { value: "waiting", label: "Waiting on quotes", tip: "Enter each sub as a placeholder line now and finish the rest of the bid; drop the number in when it arrives." },
      { value: "compare", label: "Comparing quotes", tip: "Put each sub on its own line with a note on what their quote includes, so gaps show up before you send." },
      { value: "markup", label: "Adding my markup", tip: "Sub lines get your markup automatically; set a different one per line if you mark subs up less." },
    ] },
    { goal: "profit", pain: "allowances", prompt: "Do you mark up allowances?", options: [
      { value: "yes", label: "Yes, like everything else", tip: "Keep allowances as marked-up lines and look at how much of your profit rides on them." },
      { value: "no", label: "No, at cost", tip: "Set allowance lines to pass-through so they bill at cost, and check your margin on the work you actually do." },
      { value: "unsure", label: "Not sure", tip: "Try both: switch one allowance between marked-up and pass-through and watch the profit change." },
    ] },
  ],
  deep: [{ prompt: "How do you handle selections today?", options: [opt("allowance", "Allowance amounts in the bid"), opt("before", "Customer picks before I bid"), opt("exclude", "I exclude them"), opt("mix", "Depends on the customer")] }],
};

// ---------------------------------------------------------------------------
// Electrical
// ---------------------------------------------------------------------------
const electrical: TradeBank = {
  key: "electrical", label: "Electrical", noun: "electrical job", catalogSlug: "electrical",
  jobPrompt: "What kind of electrical work do you bid most?",
  jobs: [
    { value: "service", label: "Service work", title: "200-amp panel and service upgrade", areas: ["panel", "wire", "devices", "labor"], scale: 0.35, scope: "Replace the existing panel with a 200-amp panel and service entrance, add AFCI/GFCI breakers as required, and coordinate with the utility." },
    { value: "remodel", label: "Remodels", title: "Kitchen remodel wiring", areas: ["devices", "wire", "panel", "labor"], scope: "Rough-in and trim-out new kitchen circuits, devices and recessed lighting, with breakers added to the existing panel." },
    { value: "new", label: "New construction", title: "New home rough-in and trim", areas: ["devices", "wire", "panel", "labor"], scale: 2.2, scope: "Complete rough-in, panel and trim-out for a new home, including devices, fixtures and inspections." },
  ],
  painPrompt: "What takes the longest to price on an electrical job?",
  pains: [
    { value: "devices", label: "Fixtures and devices", area: "devices", noun: "fixtures and devices", lines: "devices, boxes, fixtures and trim-out labor" },
    { value: "wire", label: "Wire runs", area: "wire", noun: "wire runs", lines: "wire by the foot, conduit and rough-in labor" },
    { value: "panel", label: "Panel work", area: "panel", noun: "panel work", lines: "panel, breakers, service entrance and labor" },
    { value: "labor", label: "Labor", area: "labor", noun: "labor and testing", lines: "testing, inspection prep, permit and trip charge" },
  ],
  areas: {
    devices: { group: "Devices & Fixtures", detail: [["Devices (outlets and switches)", "each", "material", 24, 6], ["Device boxes", "each", "material", 24, 3], ["Recessed lights", "each", "material", 12, 38], ["Light fixtures (allowance)", "each", "material", 4, 120], ["Trim-out labor", "hour", "labor", 14, 85]], pkg: [["Devices and fixtures", "lump sum", "labor_material", 1, 3000]] },
    wire: { group: "Wire Runs", detail: [["12/2 NM wire", "linear foot", "material", 750, 0.85], ["14/2 NM wire", "linear foot", "material", 500, 0.65], ["Conduit and fittings", "linear foot", "material", 60, 3.5], ["Rough-in labor", "hour", "labor", 26, 85]], pkg: [["Wiring rough-in", "lump sum", "labor_material", 1, 3500]] },
    panel: { group: "Panel & Service", detail: [["200-amp panel", "each", "material", 1, 650], ["AFCI/GFCI breakers", "each", "material", 12, 48], ["Meter base and service entrance", "lump sum", "material", 1, 550], ["Panel and service labor", "hour", "labor", 12, 95]], pkg: [["Panel and service", "lump sum", "labor_material", 1, 3500]] },
    labor: { group: "Testing & Permits", detail: [["Testing and inspection prep", "hour", "labor", 4, 85], ["Electrical permit", "each", "permit", 1, 225], ["Trip charge", "each", "other", 1, 75]], pkg: [["Testing, inspection and permit", "lump sum", "labor", 1, 640]] },
  },
  specials: [
    { goal: "speed", pain: "devices", prompt: "What slows down device counts?", options: [
      { value: "plans", label: "Counting from plans", tip: "Count by room, then enter devices and fixtures as saved lines so the count is the only thing you type." },
      { value: "walkthrough", label: "Turning walkthrough notes into a list", tip: "Type counts into the estimate during the walkthrough on your phone, room by room." },
      { value: "pricing", label: "Pricing each device type", tip: "Save your usual devices with your costs once; next time it's pick and count." },
    ] },
    { goal: "profit", pain: "labor", prompt: "How do you price electrical labor?", options: [
      { value: "units", label: "Labor units per device", tip: "Keep labor as hours per section so the margin on rough-in and trim-out shows separately." },
      { value: "hours", label: "Estimated hours", tip: "Enter hours per phase. If trim-out always runs over, the low margin there will show." },
      { value: "flat", label: "Flat rate per job type", tip: "Check your flat rate against the hours once; the profit line tells you if it still works." },
    ] },
  ],
  deep: [{ prompt: "Do you usually price by device count or by hours?", options: [opt("count", "Device count"), opt("hours", "Hours"), opt("both", "Both"), opt("flat", "Flat rates")] }],
};

// ---------------------------------------------------------------------------
// Drywall
// ---------------------------------------------------------------------------
const drywall: TradeBank = {
  key: "drywall", label: "Drywall", noun: "drywall job", catalogSlug: "drywall",
  jobPrompt: "What kind of drywall work do you bid most?",
  jobs: [
    { value: "repairs", label: "Repairs", title: "Ceiling repair after water damage", areas: ["board", "hanging", "finish", "texture"], scale: 0.08, scope: "Cut out water-damaged ceiling, hang new board, tape, finish and match the existing knockdown texture." },
    { value: "remodels", label: "Remodels", title: "Basement remodel drywall", areas: ["board", "hanging", "finish", "texture"], scale: 0.6, scope: "Hang, tape and finish drywall in the finished basement to Level 4, with texture to match the stairwell." },
    { value: "new", label: "New construction", title: "New home hang and finish", areas: ["board", "hanging", "finish"], scale: 1.5, scope: "Hang and finish drywall throughout to Level 4, ready for paint." },
  ],
  painPrompt: "What takes the longest to price on a drywall job?",
  pains: [
    { value: "board", label: "Board quantities", area: "board", skipJobs: ["repairs"], noun: "board quantities", lines: "sheets, mud, tape, bead and waste" },
    { value: "hanging", label: "Hanging labor", area: "hanging", noun: "hanging labor", lines: "walls and ceilings at their own rates, plus board carry" },
    { value: "finish", label: "Finish level", area: "finish", noun: "finish level", lines: "taping to a stated level and sanding" },
    { value: "texture", label: "Texture matching", area: "texture", skipJobs: ["new"], noun: "texture matching", lines: "texture labor and a sample board" },
  ],
  areas: {
    board: { group: "Board & Materials", detail: [["1/2 in. drywall, 4×12", "sheet", "material", 34, 18], ["Waste allowance", "sheet", "material", 3, 18], ["Joint compound", "box", "material", 9, 19], ["Tape and corner bead", "lump sum", "material", 1, 145], ["Screws", "box", "material", 4, 12]], pkg: [["Drywall materials", "lump sum", "material", 1, 1050]] },
    hanging: { group: "Hanging", detail: [["Hang walls", "square foot", "labor", 1150, 0.55], ["Hang ceilings", "square foot", "labor", 450, 0.7], ["Delivery and board carry", "lump sum", "delivery", 1, 150]], pkg: [["Hanging labor", "square foot", "labor", 1600, 0.65]] },
    finish: { group: "Taping & Finish", detail: [["Tape and finish to Level 4", "square foot", "labor", 1600, 0.75], ["Sanding and dust control", "lump sum", "labor", 1, 180]], pkg: [["Taping and finishing", "square foot", "labor", 1600, 0.85]] },
    texture: { group: "Texture", detail: [["Knockdown texture match", "square foot", "labor", 400, 0.55], ["Texture sample board", "each", "material", 1, 40]], pkg: [["Texture", "square foot", "labor", 400, 0.6]] },
  },
  specials: [
    { goal: "profit", pain: "finish", prompt: "How do you price finish levels?", options: [
      { value: "same", label: "Same price for every level", tip: "Price Level 4 and Level 5 as different lines. The margin on a Level 5 job at a Level 4 price is easy to see." },
      { value: "add", label: "An add per level", tip: "Keep the Level 5 add as its own line so you can see what it earns." },
      { value: "hourly", label: "Hourly", tip: "Enter finish hours and check the margin; finish work is where hours slip." },
    ] },
    { goal: "proposals", pain: "finish", prompt: "What do customers get confused about?", options: [
      { value: "levels", label: "What the finish levels mean", tip: "Put the finish level in the line name and a one-line explanation in the scope." },
      { value: "paint", label: "Whether it's ready for paint", tip: "Say in the scope whether primer and paint are included or excluded." },
      { value: "texture", label: "Texture matching", tip: "Write that texture matching is best-effort and show it as its own line." },
    ] },
  ],
  deep: [{ prompt: "How do you usually price drywall?", options: [opt("board", "By the board"), opt("sqft", "By the square foot"), opt("hour", "By the hour"), opt("mix", "A mix")] }],
};

export const BANKS: TradeBank[] = [decks, remodeling, painting, roofing, siding, concrete, electrical, drywall];
const byKey = new Map(BANKS.map((b) => [b.key, b]));
export const getBank = (key: string | undefined | null): TradeBank | undefined => (key ? byKey.get(key) : undefined);

/** Catalog trade slug -> questionnaire bank, for links like ?trade=kitchens or ?trade=decks. */
export const SLUG_TO_BANK: Record<string, { bank: string; job?: string }> = {
  decks: { bank: "decks" }, painting: { bank: "painting" }, roofing: { bank: "roofing" }, siding: { bank: "siding" },
  concrete: { bank: "concrete" }, electrical: { bank: "electrical" }, drywall: { bank: "drywall" },
  remodeling: { bank: "remodeling" }, "interior-remodeling": { bank: "remodeling", job: "renovations" },
  kitchens: { bank: "remodeling", job: "kitchens" }, bathrooms: { bank: "remodeling", job: "bathrooms" },
};

/** Pains this kind of job actually has. */
export function painsFor(bank: TradeBank, jobValue: string | undefined): Pain[] {
  const job = bank.jobs.find((j) => j.value === jobValue);
  if (!job) return bank.pains;
  return bank.pains.filter((p) => job.areas.includes(p.area) && !(p.skipJobs ?? []).includes(job.value));
}

export function specialFor(bank: TradeBank, goal: string | undefined, pain: string | undefined): Special | undefined {
  return bank.specials.find((s) => s.goal === goal && s.pain === pain);
}

export function deepFor(bank: TradeBank, job: string | undefined): DeepQuestion | undefined {
  return bank.deep.find((d) => !d.jobs || (job !== undefined && d.jobs.includes(job)));
}
