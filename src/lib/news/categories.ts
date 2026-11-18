import type { ArticleType, Category, GeoLevel } from "./types";

export const CATEGORY_LABEL: Record<Category, string> = {
  local_construction: "Local Construction",
  building_codes: "Building Codes",
  licensing_regulations: "Licensing & Regulations",
  material_prices: "Material Prices",
  labor_workforce: "Labor & Workforce",
  safety: "Safety",
  trade_association: "Trade Association News",
  housing_market: "Housing Market",
  commercial_construction: "Commercial Construction",
  residential_construction: "Residential Construction",
  business_taxes: "Business & Taxes",
  industry_technology: "Industry Technology",
  disaster_recovery: "Storms & Disaster Recovery",
  community: "Community Discussions",
};

/** Keyword rules for categories (headline + description). Order doesn't matter; an item can have several. */
export const CATEGORY_RULES: Record<Exclude<Category, "community" | "local_construction">, string[]> = {
  building_codes: ["building code", "building codes", "energy code", "residential code", "international code council", "icc", "irc", "ibc", "iecc", "nfpa 70", "national electrical code", "code change", "code update", "energy conservation standard", "energy conservation standards", "efficiency standard", "efficiency standards", "test procedure"],
  licensing_regulations: ["license", "licensing", "licensed", "regulation", "regulations", "rule", "rulemaking", "final rule", "proposed rule", "compliance", "permit", "permits", "permitting", "certification", "renovation, repair and painting", "rrp", "epa", "registration"],
  material_prices: ["price", "prices", "pricing", "cost of", "costs", "tariff", "tariffs", "lumber", "steel", "copper", "aluminum", "inflation", "producer price", "ppi", "supply chain", "shortage", "material costs", "building materials"],
  labor_workforce: ["labor", "workforce", "workers", "worker", "hiring", "wages", "wage", "employment", "jobs", "apprenticeship", "apprentices", "immigration", "h-2b", "overtime", "prevailing wage", "davis-bacon", "unemployment", "skilled trades", "staffing"],
  safety: ["safety", "osha", "injury", "injuries", "fatality", "fatal", "fall protection", "falls", "heat illness", "silica", "trench", "trenching", "hazard", "hazards", "citation", "cited", "penalties", "respirator", "ppe", "lockout"],
  trade_association: ["association", "nahb", "nrca", "neca", "acca", "phcc", "nalp", "agc", "abc", "nari", "nkba", "awci", "convention", "expo", "conference"],
  housing_market: ["housing", "home sales", "housing starts", "builder confidence", "home prices", "mortgage", "new home", "new homes", "single-family", "multifamily", "remodeling market", "home building", "homebuilding"],
  commercial_construction: ["commercial", "nonresidential", "office", "retail", "data center", "data centers", "warehouse", "hospital", "infrastructure", "contractor backlog", "construction spending", "megaproject"],
  residential_construction: ["residential", "home", "homes", "homeowner", "homeowners", "house", "remodel", "remodeling", "renovation", "single-family"],
  business_taxes: ["tax", "taxes", "irs", "deduction", "credit", "credits", "small business", "insurance", "liability", "lending", "interest rate", "interest rates", "financing", "payment", "earnings", "acquisition", "merger"],
  industry_technology: ["software", "technology", "drone", "drones", "artificial intelligence", "ai", "robot", "robotics", "app", "digital", "bim", "automation", "electric equipment", "battery"],
  disaster_recovery: ["disaster", "hurricane", "tornado", "flood", "flooding", "wildfire", "hail", "severe storm", "severe storms", "storm damage", "fema", "recovery", "rebuild", "rebuilding"],
};

/** Words that show an item is about building work at all (gate for broad government feeds). */
export const CONSTRUCTION_TERMS = [
  "construction", "contractor", "contractors", "building", "buildings", "residential", "home", "homes", "housing", "remodel", "remodeling", "renovation",
  "roof", "roofing", "electrical", "plumbing", "hvac", "heat pump", "heat pumps", "furnace", "furnaces", "water heater", "water heaters", "air conditioner", "air conditioners",
  "boiler", "boilers", "refrigerant", "refrigerants", "insulation", "window", "windows", "door", "doors", "lighting", "lamps", "concrete", "masonry", "lumber", "drywall",
  "lead-based paint", "lead paint", "renovation, repair and painting", "asbestos", "silica", "trench", "trenching", "excavation", "scaffold", "scaffolds", "crane", "cranes",
  "fall protection", "ladder", "ladders", "demolition", "paving", "asphalt", "landscape", "landscaping", "stormwater", "wood stove", "wood heaters", "fireplace",
  "spray foam", "formaldehyde", "composite wood", "manufactured housing", "appliance", "appliances", "construction industry", "building code", "energy code",
];

export const ARTICLE_TYPE_LABEL: Record<ArticleType, string> = {
  final_rule: "Final rule", proposed_rule: "Proposed rule", notice: "Official notice", enforcement: "Enforcement", disaster_declaration: "Disaster declaration",
  news: "News", analysis: "Analysis", product: "Product news", discussion: "Discussion",
};

export const GEO_LABEL: Record<GeoLevel, string> = { local: "Local", state: "State", regional: "Regional", national: "National" };

/** Regions used by regional trade-press feeds, mapped to states (US Census regions, ACHR's naming). */
export const REGION_STATES: Record<string, string[]> = {
  Northeast: ["CT", "ME", "MA", "NH", "RI", "VT", "NJ", "NY", "PA"],
  Southeast: ["DE", "FL", "GA", "MD", "NC", "SC", "VA", "DC", "WV", "AL", "KY", "MS", "TN"],
  Midwest: ["IL", "IN", "MI", "OH", "WI", "IA", "KS", "MN", "MO", "NE", "ND", "SD"],
  Southwest: ["AZ", "NM", "OK", "TX", "AR", "LA"],
  West: ["CO", "ID", "MT", "NV", "UT", "WY", "AK", "CA", "HI", "OR", "WA"],
};
export const regionOfState = (st: string | null): string | null => (st ? Object.entries(REGION_STATES).find(([, s]) => s.includes(st))?.[0] ?? null : null);
