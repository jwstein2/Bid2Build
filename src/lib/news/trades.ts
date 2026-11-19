import type { Category } from "./types";

/**
 * Trade → news mapping for every trade in src/lib/trades/data.ts (39 today; a test fails if a trade is
 * added there without a mapping here).
 *
 * associations: recognized organizations for the trade, listed for reference and for the "where this
 *   comes from" panel. Listing one never implies Built2Bid is a member, partner or endorsed by it.
 *   `feed` names a source in sources.ts only when we verified a free official feed; otherwise null
 *   (their newsrooms are not scraped).
 * publications: source keys of verified trade-press feeds that cover the trade.
 * official: source keys of government sources that matter for the trade.
 * keywords: strong terms matched against headline + description (whole words, case-insensitive).
 * related: weaker terms (half weight).
 * exclude: terms that mean the item is about something else (e.g. "roofing" in a tariff notice for
 *   imported roofing nails is still relevant, but "electrical" in "electrical engineering degree" isn't).
 * geo: how much local coverage matters (storm trades lean local; specialty manufacturing news is national).
 */
export interface Association { name: string; abbr?: string; url: string; role: "primary" | "secondary"; feed: string | null }
export interface TradeNewsDef {
  slug: string;
  associations: Association[];
  publications: string[];
  official: string[];
  topics: Category[];
  keywords: string[];
  related: string[];
  exclude: string[];
  geo: "local_heavy" | "balanced" | "national";
  market: "residential" | "commercial" | "both";
}

const A = (name: string, abbr: string | undefined, url: string, role: Association["role"] = "primary", feed: string | null = null): Association => ({ name, abbr, url, role, feed });

// Common association references.
const NAHB = A("National Association of Home Builders", "NAHB", "https://www.nahb.org", "secondary", "nahb-eye-on-housing");
const NARI = A("National Association of the Remodeling Industry", "NARI", "https://www.nari.org", "secondary");
const AGC = A("Associated General Contractors of America", "AGC", "https://www.agc.org", "secondary");
const ABC = A("Associated Builders and Contractors", "ABC", "https://www.abc.org", "secondary");
const NKBA = A("National Kitchen & Bath Association", "NKBA", "https://nkba.org");
const ACI = A("American Concrete Institute", "ACI", "https://www.concrete.org");
const ASCC = A("American Society of Concrete Contractors", "ASCC", "https://www.ascconline.org");
const PWNA = A("Power Washers of North America", "PWNA", "https://www.pwna.org");
const NRCA = A("National Roofing Contractors Association", "NRCA", "https://www.nrca.net");

const OFFICIAL_SAFETY = ["fr-osha", "osha-news"];
const OFFICIAL_ENERGY = ["fr-doe-eere"];
const OFFICIAL_ENV = ["fr-epa"];
const OFFICIAL_LABOR = ["fr-dol-whd"];
const OFFICIAL_STORM = ["fema-declarations"];
const GENERAL_PRESS = ["construction-dive"];
const REMODEL_PRESS = ["jlc", "construction-dive"];
const HEAVY_PRESS = ["forconstructionpros", "construction-dive"];

const T = (slug: string, d: Omit<TradeNewsDef, "slug">): TradeNewsDef => ({ slug, ...d });

export const TRADE_NEWS: TradeNewsDef[] = [
  T("roofing", {
    associations: [NRCA, A("Asphalt Roofing Manufacturers Association", "ARMA", "https://www.asphaltroofing.org", "secondary"), A("Metal Roofing Alliance", "MRA", "https://metalroofing.com", "secondary")],
    publications: ["roofing-contractor", "achr-news"], official: [...OFFICIAL_SAFETY, ...OFFICIAL_STORM],
    topics: ["safety", "building_codes", "material_prices", "disaster_recovery", "labor_workforce"],
    keywords: ["roofing", "roofer", "roofers", "roof", "roofs", "shingle", "shingles", "reroof", "re-roof", "underlayment", "metal roofing"],
    related: ["fall protection", "hail", "storm damage", "ice dam", "flashing", "attic ventilation"],
    exclude: ["roof of the mouth", "raise the roof"], geo: "local_heavy", market: "both",
  }),
  T("siding", {
    associations: [A("Vinyl Siding Institute", "VSI", "https://www.vinylsiding.org"), NAHB, NARI],
    publications: REMODEL_PRESS, official: [...OFFICIAL_STORM, ...OFFICIAL_SAFETY],
    topics: ["material_prices", "disaster_recovery", "residential_construction", "building_codes"],
    keywords: ["siding", "vinyl siding", "fiber cement", "cladding", "soffit", "fascia", "house wrap"],
    related: ["exterior", "hail", "storm damage", "weather barrier"], exclude: [], geo: "local_heavy", market: "residential",
  }),
  T("decks", {
    associations: [A("North American Deck and Railing Association", "NADRA", "https://www.nadra.org"), NAHB],
    publications: REMODEL_PRESS, official: OFFICIAL_SAFETY,
    topics: ["building_codes", "material_prices", "residential_construction", "safety"],
    keywords: ["deck", "decks", "decking", "porch", "porches", "railing", "railings", "composite decking", "pressure-treated"],
    related: ["lumber", "ledger", "outdoor living", "joist"], exclude: ["on deck", "flight deck", "slide deck", "ship deck"], geo: "balanced", market: "residential",
  }),
  T("concrete", {
    associations: [ACI, ASCC, A("National Ready Mixed Concrete Association", "NRMCA", "https://www.nrmca.org", "secondary")],
    publications: HEAVY_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_ENV],
    topics: ["material_prices", "safety", "building_codes", "commercial_construction"],
    keywords: ["concrete", "cement", "ready-mix", "ready mix", "slab", "flatwork", "rebar", "silica"],
    related: ["driveway", "foundation", "aggregate", "curing"], exclude: ["concrete plan", "concrete steps toward", "concrete proposal", "concrete evidence"], geo: "balanced", market: "both",
  }),
  T("kitchens", {
    associations: [NKBA, NARI, NAHB],
    publications: REMODEL_PRESS, official: ["fr-doe-eere", "fr-epa"],
    topics: ["residential_construction", "material_prices", "housing_market"],
    keywords: ["kitchen", "kitchens", "kitchen remodel", "cabinetry", "countertop", "countertops", "appliance", "appliances"],
    related: ["remodel", "remodeling", "renovation", "lead-safe"], exclude: ["soup kitchen", "test kitchen"], geo: "balanced", market: "residential",
  }),
  T("bathrooms", {
    associations: [NKBA, NARI, NAHB],
    publications: REMODEL_PRESS, official: ["fr-doe-eere", "fr-epa"],
    topics: ["residential_construction", "material_prices", "housing_market"],
    keywords: ["bathroom", "bathrooms", "bath remodel", "shower", "showers", "vanity", "tub", "waterproofing"],
    related: ["remodel", "remodeling", "tile", "plumbing fixture"], exclude: [], geo: "balanced", market: "residential",
  }),
  T("interior-remodeling", {
    associations: [NARI, NAHB],
    publications: REMODEL_PRESS, official: ["fr-epa", "fr-osha"],
    topics: ["residential_construction", "housing_market", "material_prices", "licensing_regulations"],
    keywords: ["remodel", "remodeling", "remodeler", "remodelers", "renovation", "renovations", "home improvement"],
    related: ["interior", "lead-safe", "renovation, repair and painting", "drywall", "flooring"], exclude: [], geo: "balanced", market: "residential",
  }),
  T("exterior-remodeling", {
    associations: [NARI, NAHB],
    publications: REMODEL_PRESS, official: [...OFFICIAL_STORM, "fr-epa"],
    topics: ["residential_construction", "disaster_recovery", "material_prices"],
    keywords: ["exterior remodel", "exterior renovation", "remodel", "remodeling", "home improvement", "curb appeal"],
    related: ["siding", "windows", "storm damage", "rot repair"], exclude: [], geo: "local_heavy", market: "residential",
  }),
  T("drywall", {
    associations: [A("Association of the Wall and Ceiling Industry", "AWCI", "https://www.awci.org")],
    publications: ["walls-ceilings", "jlc"], official: OFFICIAL_SAFETY,
    topics: ["material_prices", "labor_workforce", "safety", "commercial_construction"],
    keywords: ["drywall", "gypsum", "wallboard", "plaster", "plastering", "ceiling", "ceilings", "metal framing", "taping"],
    related: ["interior finishing", "silica", "acoustical"], exclude: ["glass ceiling", "debt ceiling", "price ceiling"], geo: "balanced", market: "both",
  }),
  T("painting", {
    associations: [A("Painting Contractors Association", "PCA", "https://www.pcapainted.org"), A("Master Painters Institute", "MPI", "https://www.paintinfo.com", "secondary")],
    publications: REMODEL_PRESS, official: ["fr-epa", ...OFFICIAL_SAFETY],
    topics: ["licensing_regulations", "safety", "material_prices", "residential_construction"],
    keywords: ["painting", "painter", "painters", "paint", "paints", "coatings", "primer", "lead paint", "lead-based paint"],
    related: ["renovation, repair and painting", "lead-safe", "volatile organic", "voc"], exclude: ["painting a picture", "oil painting", "art exhibit"], geo: "balanced", market: "both",
  }),
  T("electrical", {
    associations: [A("National Electrical Contractors Association", "NECA", "https://www.necanet.org"), A("National Fire Protection Association", "NFPA", "https://www.nfpa.org"), A("Independent Electrical Contractors", "IEC", "https://www.ieci.org", "secondary")],
    publications: GENERAL_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_ENERGY],
    topics: ["building_codes", "safety", "licensing_regulations", "industry_technology", "material_prices"],
    keywords: ["electrical", "electrician", "electricians", "wiring", "national electrical code", "nec", "arc flash", "lockout/tagout", "lockout", "ev charger", "ev chargers", "transformer", "transformers", "solar"],
    related: ["electrification", "panel upgrade", "generator", "battery storage", "lighting"], exclude: ["electrical engineering degree", "electrical storm"], geo: "balanced", market: "both",
  }),
  T("plumbing", {
    associations: [A("Plumbing-Heating-Cooling Contractors Association", "PHCC", "https://www.phccweb.org"), A("International Association of Plumbing and Mechanical Officials", "IAPMO", "https://www.iapmo.org", "secondary"), A("American Society of Plumbing Engineers", "ASPE", "https://www.aspe.org", "secondary")],
    publications: ["pm-mag", "achr-news"], official: [...OFFICIAL_ENERGY, ...OFFICIAL_ENV, ...OFFICIAL_SAFETY],
    topics: ["building_codes", "licensing_regulations", "material_prices", "safety"],
    keywords: ["plumbing", "plumber", "plumbers", "water heater", "water heaters", "backflow", "lead service line", "lead pipes", "piping", "pex", "drain", "sewer"],
    related: ["hydronic", "fixture", "water efficiency", "watersense"], exclude: [], geo: "balanced", market: "both",
  }),
  T("hvac", {
    associations: [A("Air Conditioning Contractors of America", "ACCA", "https://www.acca.org"), A("Air-Conditioning, Heating, and Refrigeration Institute", "AHRI", "https://www.ahrinet.org", "secondary"), A("Plumbing-Heating-Cooling Contractors Association", "PHCC", "https://www.phccweb.org", "secondary")],
    publications: ["achr-news", "pm-mag"], official: [...OFFICIAL_ENERGY, ...OFFICIAL_ENV, ...OFFICIAL_SAFETY],
    topics: ["building_codes", "licensing_regulations", "material_prices", "industry_technology", "labor_workforce"],
    keywords: ["hvac", "hvacr", "heat pump", "heat pumps", "furnace", "furnaces", "air conditioner", "air conditioners", "air conditioning", "refrigerant", "refrigerants", "a2l", "ductwork", "boiler", "boilers"],
    related: ["energy efficiency", "aim act", "hydrofluorocarbon", "hfc", "indoor air quality", "electrification"], exclude: [], geo: "balanced", market: "both",
  }),
  T("flooring", {
    associations: [A("National Wood Flooring Association", "NWFA", "https://www.nwfa.org"), A("World Floor Covering Association", "WFCA", "https://wfca.org", "secondary")],
    publications: ["fcnews", "jlc"], official: OFFICIAL_SAFETY,
    topics: ["material_prices", "residential_construction", "commercial_construction"],
    keywords: ["flooring", "floor covering", "hardwood", "laminate", "vinyl plank", "lvp", "lvt", "carpet", "carpeting", "floors"],
    related: ["subfloor", "underlayment", "tariff"], exclude: ["trading floor", "senate floor", "house floor", "factory floor"], geo: "national", market: "both",
  }),
  T("tile", {
    associations: [A("National Tile Contractors Association", "NTCA", "https://www.tile-assn.com"), A("Tile Council of North America", "TCNA", "https://www.tcnatile.com", "secondary")],
    publications: ["fcnews", "jlc"], official: OFFICIAL_SAFETY,
    topics: ["material_prices", "residential_construction", "safety"],
    keywords: ["tile", "tiles", "tiling", "ceramic", "porcelain", "grout", "thinset", "stone tile"],
    related: ["silica", "shower", "backsplash", "tariff"], exclude: [], geo: "national", market: "both",
  }),
  T("framing", {
    associations: [A("Structural Building Components Association", "SBCA", "https://www.sbcacomponents.com"), A("APA – The Engineered Wood Association", "APA", "https://www.apawood.org", "secondary"), NAHB],
    publications: REMODEL_PRESS, official: OFFICIAL_SAFETY,
    topics: ["material_prices", "safety", "residential_construction", "building_codes"],
    keywords: ["framing", "framer", "framers", "lumber", "softwood lumber", "oriented strand board", "osb", "plywood", "trusses", "truss", "wood framing"],
    related: ["fall protection", "sheathing", "tariff", "home building"], exclude: ["framing the debate", "framing the issue"], geo: "national", market: "both",
  }),
  T("finish-carpentry", {
    associations: [A("Architectural Woodwork Institute", "AWI", "https://www.awinet.org"), NAHB, NARI],
    publications: REMODEL_PRESS, official: OFFICIAL_SAFETY,
    topics: ["residential_construction", "material_prices"],
    keywords: ["finish carpentry", "carpentry", "carpenter", "carpenters", "trim", "millwork", "molding", "moulding", "woodwork", "interior doors"],
    related: ["remodeling", "built-ins", "lumber"], exclude: ["trim the budget", "trim spending"], geo: "national", market: "residential",
  }),
  T("cabinets-countertops", {
    associations: [A("Kitchen Cabinet Manufacturers Association", "KCMA", "https://www.kcma.org"), NKBA, A("International Surface Fabricators Association", "ISFA", "https://www.isfanow.org", "secondary")],
    publications: REMODEL_PRESS, official: OFFICIAL_SAFETY,
    topics: ["material_prices", "residential_construction", "safety"],
    keywords: ["cabinet", "cabinets", "cabinetry", "countertop", "countertops", "quartz", "granite", "engineered stone", "solid surface"],
    related: ["silica", "kitchen remodel", "tariff"], exclude: ["cabinet secretary", "cabinet members", "presidential cabinet", "cabinet meeting"], geo: "national", market: "residential",
  }),
  T("windows-doors", {
    associations: [A("Fenestration and Glazing Industry Alliance", "FGIA", "https://fgiaonline.org"), A("National Fenestration Rating Council", "NFRC", "https://www.nfrc.org", "secondary")],
    publications: REMODEL_PRESS, official: [...OFFICIAL_ENERGY, ...OFFICIAL_STORM],
    topics: ["building_codes", "material_prices", "residential_construction", "disaster_recovery"],
    keywords: ["window", "windows", "replacement windows", "fenestration", "glazing", "skylight", "skylights", "entry door", "patio door", "storm door", "energy star windows"],
    related: ["energy efficiency", "egress", "impact-resistant", "hurricane"], exclude: ["window of opportunity", "microsoft windows", "windows 11", "windows 10", "drive-thru window"], geo: "balanced", market: "residential",
  }),
  T("insulation", {
    associations: [A("Insulation Contractors Association of America", "ICAA", "https://www.insulate.org"), A("National Insulation Association", "NIA", "https://www.insulation.org", "secondary")],
    publications: ["walls-ceilings", "jlc"], official: [...OFFICIAL_ENERGY, ...OFFICIAL_SAFETY],
    topics: ["building_codes", "material_prices", "industry_technology"],
    keywords: ["insulation", "insulating", "spray foam", "spray polyurethane foam", "blown-in", "fiberglass insulation", "cellulose", "air sealing", "weatherization"],
    related: ["energy code", "energy efficiency", "r-value", "home energy rebates"], exclude: ["insulation from", "insulated from criticism"], geo: "balanced", market: "both",
  }),
  T("gutters", {
    associations: [NRCA, NAHB],
    publications: ["roofing-contractor", "jlc"], official: [...OFFICIAL_STORM, ...OFFICIAL_SAFETY],
    topics: ["disaster_recovery", "safety", "material_prices"],
    keywords: ["gutter", "gutters", "downspout", "downspouts", "seamless gutter", "gutter guard", "gutter guards"],
    related: ["roofing", "storm damage", "drainage", "ladder safety"], exclude: ["in the gutter"], geo: "local_heavy", market: "residential",
  }),
  T("fencing", {
    associations: [A("American Fence Association", "AFA", "https://www.americanfenceassociation.com")],
    publications: ["construction-dive", "jlc"], official: [...OFFICIAL_STORM, ...OFFICIAL_SAFETY],
    topics: ["material_prices", "disaster_recovery", "residential_construction"],
    keywords: ["fence", "fences", "fencing", "gate", "gates", "vinyl fence", "chain link"],
    related: ["lumber", "steel", "property line", "utility locate", "811"], exclude: ["on the fence", "fence-sitter", "fencing (sport)", "olympic fencing"], geo: "local_heavy", market: "residential",
  }),
  T("landscaping", {
    associations: [A("National Association of Landscape Professionals", "NALP", "https://www.landscapeprofessionals.org"), A("Irrigation Association", "IA", "https://www.irrigation.org", "secondary")],
    publications: ["landscape-management", "lawn-landscape"], official: [...OFFICIAL_LABOR, ...OFFICIAL_ENV, ...OFFICIAL_SAFETY],
    topics: ["labor_workforce", "safety", "business_taxes", "material_prices"],
    keywords: ["landscaping", "landscaper", "landscapers", "landscape", "lawn", "lawn care", "hardscape", "hardscaping", "irrigation", "turf", "nursery", "h-2b"],
    related: ["heat illness", "seasonal workers", "water restrictions", "mowers", "pesticide"], exclude: ["political landscape", "competitive landscape", "media landscape", "threat landscape", "regulatory landscape"], geo: "local_heavy", market: "both",
  }),
  T("pressure-washing", {
    associations: [PWNA, A("United Association of Mobile Contract Cleaners", "UAMCC", "https://www.uamcc.org", "secondary")],
    publications: ["lawn-landscape", "construction-dive"], official: [...OFFICIAL_ENV, ...OFFICIAL_SAFETY],
    topics: ["licensing_regulations", "safety", "business_taxes"],
    keywords: ["pressure washing", "power washing", "pressure washer", "power washer", "exterior cleaning", "surface cleaning", "wastewater"],
    related: ["stormwater", "clean water act", "runoff", "chemical safety"], exclude: [], geo: "local_heavy", market: "both",
  }),
  T("soft-washing", {
    associations: [PWNA, A("United Association of Mobile Contract Cleaners", "UAMCC", "https://www.uamcc.org", "secondary")],
    publications: ["lawn-landscape", "roofing-contractor"], official: [...OFFICIAL_ENV, ...OFFICIAL_SAFETY],
    topics: ["licensing_regulations", "safety"],
    keywords: ["soft washing", "soft wash", "roof cleaning", "house washing", "sodium hypochlorite", "exterior cleaning"],
    related: ["stormwater", "runoff", "chemical safety", "algae"], exclude: [], geo: "local_heavy", market: "residential",
  }),
  T("cleaning", {
    associations: [A("ISSA, The Worldwide Cleaning Industry Association", "ISSA", "https://www.issa.com"), A("Association of Residential Cleaning Services International", "ARCSI", "https://www.arcsi.org", "secondary")],
    publications: GENERAL_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_LABOR, ...OFFICIAL_ENV],
    topics: ["labor_workforce", "safety", "business_taxes"],
    keywords: ["janitorial", "commercial cleaning", "residential cleaning", "house cleaning", "post-construction cleaning", "cleaning company", "cleaning companies", "cleaning crews", "custodial", "maid service"],
    related: ["cleaning chemicals", "disinfectant", "green cleaning", "hazard communication", "silica dust"], exclude: ["dry cleaning", "data cleaning", "spring cleaning sale", "ethnic cleansing"], geo: "balanced", market: "both",
  }),
  T("excavation", {
    associations: [A("National Utility Contractors Association", "NUCA", "https://www.nuca.com"), AGC],
    publications: HEAVY_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_ENV],
    topics: ["safety", "commercial_construction", "material_prices", "labor_workforce"],
    keywords: ["excavation", "excavating", "excavator", "excavators", "trench", "trenching", "earthwork", "grading", "site work", "sitework", "utility construction"],
    related: ["cave-in", "811", "underground utilities", "heavy equipment", "infrastructure"], exclude: ["archaeological excavation"], geo: "local_heavy", market: "both",
  }),
  T("foundations", {
    associations: [ACI, ASCC, NAHB],
    publications: HEAVY_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_STORM],
    topics: ["building_codes", "safety", "residential_construction"],
    keywords: ["foundation repair", "foundations", "footing", "footings", "basement wall", "crawl space", "crawlspace", "piers", "helical piles", "waterproofing"],
    related: ["concrete", "soil", "flooding", "settlement"], exclude: ["foundation grant", "charitable foundation", "foundation announced", "the foundation said", "foundation award"], geo: "balanced", market: "both",
  }),
  T("masonry", {
    associations: [A("Mason Contractors Association of America", "MCAA", "https://www.masoncontractors.org"), A("International Masonry Institute", "IMI", "https://imiweb.org", "secondary")],
    publications: HEAVY_PRESS, official: OFFICIAL_SAFETY,
    topics: ["safety", "labor_workforce", "material_prices", "commercial_construction"],
    keywords: ["masonry", "mason", "masons", "brick", "bricks", "bricklayer", "bricklaying", "block", "cmu", "stone veneer", "chimney", "tuckpointing"],
    related: ["silica", "mortar", "scaffold", "hardscape"], exclude: ["freemason", "freemasons", "mason jar", "building block", "block grant", "blockchain"], geo: "balanced", market: "both",
  }),
  T("asphalt-paving", {
    associations: [A("National Asphalt Pavement Association", "NAPA", "https://www.asphaltpavement.org"), AGC],
    publications: HEAVY_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_ENV],
    topics: ["material_prices", "safety", "commercial_construction"],
    keywords: ["asphalt", "paving", "pavement", "paver", "pavers", "sealcoating", "seal coating", "blacktop", "parking lot", "driveway paving"],
    related: ["road construction", "work zone", "infrastructure", "oil prices"], exclude: [], geo: "local_heavy", market: "both",
  }),
  T("demolition", {
    associations: [A("National Demolition Association", "NDA", "https://www.demolitionassociation.com"), AGC],
    publications: HEAVY_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_ENV],
    topics: ["safety", "licensing_regulations", "commercial_construction"],
    keywords: ["demolition", "demo", "deconstruction", "asbestos", "abatement", "teardown", "tear-down"],
    related: ["lead", "silica", "debris", "disposal", "salvage"], exclude: ["demo day", "product demo", "demo version"], geo: "local_heavy", market: "both",
  }),
  T("basements", {
    associations: [NAHB, NARI],
    publications: REMODEL_PRESS, official: [...OFFICIAL_STORM, "fr-epa"],
    topics: ["residential_construction", "building_codes", "disaster_recovery"],
    keywords: ["basement", "basements", "basement finishing", "basement remodel", "egress window", "sump pump", "radon", "waterproofing"],
    related: ["flooding", "moisture", "remodeling"], exclude: [], geo: "balanced", market: "residential",
  }),
  T("additions", {
    associations: [NAHB, NARI],
    publications: REMODEL_PRESS, official: OFFICIAL_SAFETY,
    topics: ["residential_construction", "building_codes", "housing_market", "licensing_regulations"],
    keywords: ["home addition", "home additions", "room addition", "addition", "adu", "adus", "accessory dwelling", "second story"],
    related: ["zoning", "permits", "remodeling", "home building"], exclude: ["in addition", "addition to the", "latest addition", "new addition to"], geo: "balanced", market: "residential",
  }),
  T("garages", {
    associations: [NAHB, A("International Door Association", "IDA", "https://www.doors.org", "secondary")],
    publications: REMODEL_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_ENERGY],
    topics: ["residential_construction", "building_codes"],
    keywords: ["garage", "garages", "garage door", "garage doors", "detached garage", "carport"],
    related: ["adu", "ev charger", "slab"], exclude: ["garage sale", "garage band", "parking garage collapse"], geo: "balanced", market: "residential",
  }),
  T("pole-barns", {
    associations: [A("National Frame Building Association", "NFBA", "https://nfba.org"), A("Metal Building Manufacturers Association", "MBMA", "https://www.mbma.com", "secondary")],
    publications: ["forconstructionpros", "construction-dive"], official: [...OFFICIAL_SAFETY, ...OFFICIAL_STORM],
    topics: ["material_prices", "commercial_construction", "building_codes"],
    keywords: ["pole barn", "pole barns", "post-frame", "post frame", "metal building", "metal buildings", "steel building", "agricultural building", "barn"],
    related: ["steel prices", "snow load", "wind load"], exclude: [], geo: "balanced", market: "both",
  }),
  T("commercial-remodeling", {
    associations: [AGC, ABC],
    publications: GENERAL_PRESS, official: [...OFFICIAL_SAFETY, ...OFFICIAL_LABOR],
    topics: ["commercial_construction", "labor_workforce", "material_prices", "business_taxes"],
    keywords: ["commercial construction", "tenant improvement", "tenant fit-out", "fit-out", "office renovation", "retail construction", "commercial remodel", "nonresidential"],
    related: ["prevailing wage", "davis-bacon", "construction spending", "general contractor"], exclude: [], geo: "balanced", market: "commercial",
  }),
  T("general-contracting", {
    associations: [NAHB, AGC, ABC],
    publications: ["construction-dive", "jlc", "nahb-eye-on-housing"], official: [...OFFICIAL_SAFETY, ...OFFICIAL_LABOR, ...OFFICIAL_STORM],
    topics: ["housing_market", "labor_workforce", "material_prices", "business_taxes", "safety"],
    keywords: ["general contractor", "general contractors", "contractor", "contractors", "construction", "home builder", "home builders", "homebuilding", "builder", "builders"],
    related: ["construction spending", "housing starts", "building permits", "construction employment"], exclude: [], geo: "balanced", market: "both",
  }),
  T("handyman", {
    associations: [NARI, NAHB],
    publications: ["jlc", "construction-dive"], official: [...OFFICIAL_SAFETY, "fr-epa"],
    topics: ["licensing_regulations", "residential_construction", "business_taxes"],
    keywords: ["handyman", "handymen", "home repair", "home repairs", "home maintenance", "small jobs"],
    related: ["licensing", "lead-safe", "remodeling", "home improvement"], exclude: [], geo: "local_heavy", market: "residential",
  }),
  T("other", {
    associations: [NAHB, AGC],
    publications: ["construction-dive"], official: OFFICIAL_SAFETY,
    topics: ["labor_workforce", "material_prices", "business_taxes", "safety"],
    keywords: ["contractor", "contractors", "construction"],
    related: ["building", "remodeling"], exclude: [], geo: "balanced", market: "both",
  }),
];

const BY_SLUG = new Map(TRADE_NEWS.map((t) => [t.slug, t]));
export const tradeNews = (slug: string): TradeNewsDef | undefined => BY_SLUG.get(slug);
