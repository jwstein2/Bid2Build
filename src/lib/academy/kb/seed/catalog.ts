/**
 * Seed catalog for the Academy knowledge engine. scripts/academy/kb/gen-seed.ts combines this file with
 * official-snapshot.json (text fetched from eCFR and the Minnesota Revisor by scripts/academy/kb/fetch_official.py)
 * and writes supabase/migrations/20270220002000_academy_knowledge_seed.sql.
 *
 * Accuracy rules for anyone editing this file:
 *  - A source, adoption or section is seeded as "verified" only when `evidence` quotes the official text that proves
 *    it and `evidenceUrl` is where that text was read. Everything else is seeded as "pending_review".
 *  - Never type a requirement (a dimension, a load, a date) into a summary unless it is in the cited text.
 *  - Model codes (ICC, NFPA) are copyrighted: they get titles, editions and citations only, never their text.
 */
import { US_STATES } from "@/lib/market/geo";

export const SEED_VERIFIED_ON = "2026-11-22";

export interface FamilySeed { slug: string; name: string; short: string; kind: string; publisher: string | null; about: string; sort: number }
export const FAMILIES: FamilySeed[] = [
  { slug: "irc", name: "International Residential Code", short: "IRC", kind: "model_code", publisher: "International Code Council (ICC)", about: "Model code for one- and two-family dwellings and townhouses up to three stories. A state or city must adopt an edition (usually with amendments) before it is enforceable.", sort: 10 },
  { slug: "ibc", name: "International Building Code", short: "IBC", kind: "model_code", publisher: "International Code Council (ICC)", about: "Model code for commercial and most non-residential buildings. Enforceable only where adopted.", sort: 20 },
  { slug: "iebc", name: "International Existing Building Code", short: "IEBC", kind: "model_code", publisher: "International Code Council (ICC)", about: "Model code for repair, alteration, change of occupancy and additions to existing buildings.", sort: 30 },
  { slug: "ipc", name: "International Plumbing Code", short: "IPC", kind: "model_code", publisher: "International Code Council (ICC)", about: "Model plumbing code. Some states use the Uniform Plumbing Code or their own plumbing code instead.", sort: 40 },
  { slug: "imc", name: "International Mechanical Code", short: "IMC", kind: "model_code", publisher: "International Code Council (ICC)", about: "Model code for HVAC, exhaust and other mechanical systems.", sort: 50 },
  { slug: "ifgc", name: "International Fuel Gas Code", short: "IFGC", kind: "model_code", publisher: "International Code Council (ICC)", about: "Model code for fuel gas piping and appliances.", sort: 60 },
  { slug: "ifc", name: "International Fire Code", short: "IFC", kind: "model_code", publisher: "International Code Council (ICC)", about: "Model fire prevention code.", sort: 70 },
  { slug: "iecc", name: "International Energy Conservation Code", short: "IECC", kind: "model_code", publisher: "International Code Council (ICC)", about: "Model energy code (insulation, windows, air sealing, duct and system efficiency).", sort: 80 },
  { slug: "nec", name: "National Electrical Code (NFPA 70)", short: "NEC", kind: "standard", publisher: "National Fire Protection Association (NFPA)", about: "Electrical installation standard. States adopt an edition, often with amendments and their own effective dates.", sort: 90 },
  { slug: "mn_rules", name: "Minnesota Rules (State Building Code)", short: "Minn. R.", kind: "state_rule", publisher: "Minnesota Office of the Revisor of Statutes", about: "Minnesota's administrative rules that adopt and amend the model codes that make up the Minnesota State Building Code.", sort: 200 },
  { slug: "osha_construction", name: "OSHA Construction Standards (29 CFR Part 1926)", short: "29 CFR 1926", kind: "federal_regulation", publisher: "U.S. Department of Labor, OSHA", about: "Federal workplace safety rules for construction work. States with an OSHA-approved State Plan enforce their own standards, which must be at least as effective.", sort: 300 },
  { slug: "osha_recordkeeping", name: "OSHA Recordkeeping and Reporting (29 CFR Part 1904)", short: "29 CFR 1904", kind: "federal_regulation", publisher: "U.S. Department of Labor, OSHA", about: "Injury and illness records and the deadlines for reporting serious incidents.", sort: 310 },
  { slug: "osha_state_plans", name: "OSHA-Approved State Plans (29 CFR Part 1952)", short: "29 CFR 1952", kind: "federal_regulation", publisher: "U.S. Department of Labor, OSHA", about: "The federal list of states that run their own OSHA-approved workplace safety programs.", sort: 320 },
  { slug: "epa_lead_rrp", name: "EPA Lead Renovation, Repair and Painting Rule (40 CFR Part 745)", short: "40 CFR 745", kind: "federal_regulation", publisher: "U.S. Environmental Protection Agency", about: "Lead-safe work rules for paid renovation in pre-1978 housing and child-occupied facilities. Some states run EPA-authorized programs.", sort: 330 },
  { slug: "fmcsa", name: "FMCSA Motor Carrier Safety Regulations (49 CFR)", short: "49 CFR", kind: "federal_regulation", publisher: "U.S. Department of Transportation, FMCSA", about: "Federal commercial vehicle rules (drivers, inspections, drug and alcohol testing) for interstate commerce. States set intrastate rules.", sort: 340 },
];

export interface SourceSeed {
  key: string; family: string; title: string; short: string; edition: string; year: number | null; publisher: string;
  jurisdiction: string | null; officialUrl: string | null; readUrl: string | null; rights: string; fulltext: boolean; excerpt: boolean;
  rightsNote: string; paginationNote?: string; checkUrl?: string | null;
  /** verified needs evidence + evidenceUrl. */
  status: "verified" | "pending_review";
  evidence?: string; evidenceUrl?: string;
}

const ECFR_NOTE = "Works of the U.S. Government are not subject to copyright (17 U.S.C. 105). Text is reproduced from the eCFR, which is an editorial compilation and not the official legal edition (the annual CFR and Federal Register are).";
const ECFR_PAGES = "Online regulation: cite by section and paragraph; there are no page numbers.";
const MN_NOTE = "Official text of Minnesota Rules (state law) from the Office of the Revisor. Built2Bid shows short per-subpart excerpts of Minnesota's own amendments with the citation and a link. The incorporated ICC model code text is not reproduced.";
const MN_PAGES = "Online rule: cite by part and subpart; there are no page numbers.";
const MODEL_NOTE = "Copyrighted model code. Built2Bid stores the title, edition and section citations only. Read the text through the publisher, a licensed copy, or your building department.";

export function sourceSeeds(ecfrDates: Record<string, string>): SourceSeed[] {
  const d29 = ecfrDates["29"], d40 = ecfrDates["40"], d49 = ecfrDates["49"];
  return [
    { key: "osha-1926", family: "osha_construction", title: "Safety and Health Regulations for Construction", short: "29 CFR 1926", edition: `eCFR ${d29}`, year: Number(d29.slice(0, 4)), publisher: "OSHA (U.S. Department of Labor) via eCFR", jurisdiction: "US", officialUrl: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1926", readUrl: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1926", rights: "public_domain", fulltext: true, excerpt: true, rightsNote: ECFR_NOTE, paginationNote: ECFR_PAGES, status: "verified" },
    { key: "osha-1904", family: "osha_recordkeeping", title: "Recording and Reporting Occupational Injuries and Illnesses", short: "29 CFR 1904", edition: `eCFR ${d29}`, year: Number(d29.slice(0, 4)), publisher: "OSHA (U.S. Department of Labor) via eCFR", jurisdiction: "US", officialUrl: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1904", readUrl: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1904", rights: "public_domain", fulltext: true, excerpt: true, rightsNote: ECFR_NOTE, paginationNote: ECFR_PAGES, status: "verified" },
    { key: "osha-1952", family: "osha_state_plans", title: "Approved State Plans for Enforcement of State Standards", short: "29 CFR 1952", edition: `eCFR ${d29}`, year: Number(d29.slice(0, 4)), publisher: "OSHA (U.S. Department of Labor) via eCFR", jurisdiction: "US", officialUrl: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1952", readUrl: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1952", rights: "public_domain", fulltext: true, excerpt: true, rightsNote: ECFR_NOTE, paginationNote: ECFR_PAGES, status: "verified" },
    { key: "epa-745", family: "epa_lead_rrp", title: "Lead-Based Paint Poisoning Prevention in Certain Residential Structures", short: "40 CFR 745", edition: `eCFR ${d40}`, year: Number(d40.slice(0, 4)), publisher: "U.S. EPA via eCFR", jurisdiction: "US", officialUrl: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745", readUrl: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745", rights: "public_domain", fulltext: true, excerpt: true, rightsNote: ECFR_NOTE, paginationNote: ECFR_PAGES, status: "verified" },
    { key: "fmcsa", family: "fmcsa", title: "Federal Motor Carrier Safety Regulations (Parts 382, 391 and 396)", short: "49 CFR 382–396", edition: `eCFR ${d49}`, year: Number(d49.slice(0, 4)), publisher: "FMCSA (U.S. Department of Transportation) via eCFR", jurisdiction: "US", officialUrl: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B", readUrl: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B", rights: "public_domain", fulltext: true, excerpt: true, rightsNote: ECFR_NOTE, paginationNote: ECFR_PAGES, status: "verified" },

    // Minnesota Rules chapters (state law). Verified from the Revisor's official text.
    { key: "mn-1300", family: "mn_rules", title: "Minnesota Rules, chapter 1300: Minnesota Building Code administration", short: "Minn. R. 1300", edition: "2020 Minnesota State Building Code", year: 2020, publisher: "Minnesota Department of Labor and Industry (Office of the Revisor)", jurisdiction: "MN", officialUrl: "https://www.revisor.mn.gov/rules/1300/", readUrl: "https://www.revisor.mn.gov/rules/1300/", rights: "government_edict", fulltext: false, excerpt: true, rightsNote: MN_NOTE, paginationNote: MN_PAGES, checkUrl: "https://www.revisor.mn.gov/rules/1300.0120/", status: "verified" },
    { key: "mn-1305", family: "mn_rules", title: "Minnesota Rules, chapter 1305: Adoption of the International Building Code", short: "Minn. R. 1305", edition: "2020 Minnesota State Building Code", year: 2020, publisher: "Minnesota Department of Labor and Industry (Office of the Revisor)", jurisdiction: "MN", officialUrl: "https://www.revisor.mn.gov/rules/1305/", readUrl: "https://www.revisor.mn.gov/rules/1305/", rights: "government_edict", fulltext: false, excerpt: true, rightsNote: MN_NOTE, paginationNote: MN_PAGES, checkUrl: "https://www.revisor.mn.gov/rules/1305.0011/", status: "verified" },
    { key: "mn-1309", family: "mn_rules", title: "Minnesota Rules, chapter 1309: Adoption of the International Residential Code", short: "Minn. R. 1309", edition: "2020 Minnesota State Building Code", year: 2020, publisher: "Minnesota Department of Labor and Industry (Office of the Revisor)", jurisdiction: "MN", officialUrl: "https://www.revisor.mn.gov/rules/1309/", readUrl: "https://www.revisor.mn.gov/rules/1309/", rights: "government_edict", fulltext: false, excerpt: true, rightsNote: MN_NOTE, paginationNote: MN_PAGES, checkUrl: "https://www.revisor.mn.gov/rules/1309.0010/", status: "verified" },
    { key: "mn-1315", family: "mn_rules", title: "Minnesota Rules, chapter 1315: Minnesota Electrical Code", short: "Minn. R. 1315", edition: "2026 NEC adoption", year: 2026, publisher: "Minnesota Board of Electricity (Office of the Revisor)", jurisdiction: "MN", officialUrl: "https://www.revisor.mn.gov/rules/1315/", readUrl: "https://www.revisor.mn.gov/rules/1315/", rights: "government_edict", fulltext: false, excerpt: true, rightsNote: MN_NOTE, paginationNote: MN_PAGES, checkUrl: "https://www.revisor.mn.gov/rules/1315.0200/", status: "verified" },
    { key: "mn-1322", family: "mn_rules", title: "Minnesota Rules, chapter 1322: Minnesota Residential Energy Code", short: "Minn. R. 1322", edition: "2015 residential energy code (2012 IECC)", year: 2015, publisher: "Minnesota Department of Labor and Industry (Office of the Revisor)", jurisdiction: "MN", officialUrl: "https://www.revisor.mn.gov/rules/1322/", readUrl: "https://www.revisor.mn.gov/rules/1322/", rights: "government_edict", fulltext: false, excerpt: true, rightsNote: MN_NOTE, paginationNote: MN_PAGES, checkUrl: "https://www.revisor.mn.gov/rules/1322.0010/", status: "verified" },
    { key: "mn-1346", family: "mn_rules", title: "Minnesota Rules, chapter 1346: Minnesota Mechanical and Fuel Gas Code", short: "Minn. R. 1346", edition: "2020 Minnesota State Building Code", year: 2020, publisher: "Minnesota Department of Labor and Industry (Office of the Revisor)", jurisdiction: "MN", officialUrl: "https://www.revisor.mn.gov/rules/1346/", readUrl: "https://www.revisor.mn.gov/rules/1346/", rights: "government_edict", fulltext: false, excerpt: true, rightsNote: MN_NOTE, paginationNote: MN_PAGES, checkUrl: "https://www.revisor.mn.gov/rules/1346.0050/", status: "verified" },

    // Model codes: metadata only. Their edition is verified by the adopting text that names it.
    { key: "irc-2018", family: "irc", title: "2018 International Residential Code", short: "IRC", edition: "2018", year: 2018, publisher: "International Code Council", jurisdiction: null, officialUrl: null, readUrl: null, rights: "metadata_only", fulltext: false, excerpt: false, rightsNote: MODEL_NOTE, paginationNote: "Page numbers differ between print, PDF and online formats; Built2Bid cites sections only.", status: "verified" },
    { key: "ibc-2018", family: "ibc", title: "2018 International Building Code", short: "IBC", edition: "2018", year: 2018, publisher: "International Code Council", jurisdiction: null, officialUrl: null, readUrl: null, rights: "metadata_only", fulltext: false, excerpt: false, rightsNote: MODEL_NOTE, paginationNote: "Page numbers differ between print, PDF and online formats; Built2Bid cites sections only.", status: "verified" },
    { key: "imc-2018", family: "imc", title: "2018 International Mechanical Code", short: "IMC", edition: "2018", year: 2018, publisher: "International Code Council", jurisdiction: null, officialUrl: null, readUrl: null, rights: "metadata_only", fulltext: false, excerpt: false, rightsNote: MODEL_NOTE, status: "verified" },
    { key: "iecc-2012", family: "iecc", title: "2012 International Energy Conservation Code", short: "IECC", edition: "2012", year: 2012, publisher: "International Code Council", jurisdiction: null, officialUrl: null, readUrl: null, rights: "metadata_only", fulltext: false, excerpt: false, rightsNote: MODEL_NOTE, status: "verified" },
    { key: "nec-2026", family: "nec", title: "National Electrical Code, 2026 edition (NFPA 70)", short: "NEC", edition: "2026", year: 2026, publisher: "National Fire Protection Association", jurisdiction: null, officialUrl: null, readUrl: null, rights: "metadata_only", fulltext: false, excerpt: false, rightsNote: MODEL_NOTE, status: "verified" },
    { key: "nec-2023", family: "nec", title: "National Electrical Code, 2023 edition (NFPA 70)", short: "NEC", edition: "2023", year: 2023, publisher: "National Fire Protection Association", jurisdiction: null, officialUrl: null, readUrl: null, rights: "metadata_only", fulltext: false, excerpt: false, rightsNote: MODEL_NOTE, status: "verified" },
  ];
}

/** Evidence for model-code editions and adoptions comes from the adopting text (snapshot) or the agency's own page. */
export interface AdoptionSeed {
  key: string; jurisdiction: string; source: string; kind: "adopts" | "amends" | "replaces" | "administers"; replacesFamily?: string;
  authority: string; url: string; effective?: string | null; expires?: string | null; localConfirmation: boolean; scope?: string;
  trades?: string[]; status: "verified" | "pending_review";
  /** Where the evidence comes from: "mn:<part>" (snapshot subpart 1 text), "dli:<key>" (quoted agency page), "ecfr:<section>" or literal. */
  evidenceFrom: string;
}

const MN_LOCAL = "The Minnesota State Building Code is the minimum standard statewide, but DLI states it is not enforceable by a municipality unless adopted by local ordinance. Confirm with the city, township or county building official for the project.";

export const ADOPTIONS: AdoptionSeed[] = [
  { key: "us-osha-1926", jurisdiction: "US", source: "osha-1926", kind: "administers", authority: "29 CFR Part 1926", url: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1926", localConfirmation: false, scope: "Applies to employers doing construction work. In State Plan states the state's own OSHA program governs.", status: "verified", evidenceFrom: "ecfr:1926.20" },
  { key: "us-osha-1904", jurisdiction: "US", source: "osha-1904", kind: "administers", authority: "29 CFR Part 1904", url: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1904", localConfirmation: false, status: "verified", evidenceFrom: "ecfr:1904.1" },
  { key: "us-epa-745", jurisdiction: "US", source: "epa-745", kind: "administers", authority: "40 CFR Part 745, Subpart E", url: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745", localConfirmation: true, scope: "Federal rule for paid renovation in pre-1978 target housing and child-occupied facilities. Some states and tribes run EPA-authorized programs with their own certification.", status: "verified", evidenceFrom: "ecfr:745.82" },
  { key: "us-fmcsa", jurisdiction: "US", source: "fmcsa", kind: "administers", authority: "49 CFR Parts 382, 391 and 396", url: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B", localConfirmation: true, scope: "Federal rules for commercial motor vehicles in interstate commerce. Whether a vehicle or driver is covered depends on weight ratings, cargo, passengers and the kind of commerce, not on the trade. States set rules for intrastate operation.", status: "verified", evidenceFrom: "ecfr:391.11" },

  { key: "mn-admin-1300", jurisdiction: "MN", source: "mn-1300", kind: "administers", authority: "Minn. R. ch. 1300", url: "https://www.revisor.mn.gov/rules/1300/", effective: "2020-03-31", localConfirmation: true, scope: MN_LOCAL, status: "verified", evidenceFrom: "dli:mn-dli-building-code" },
  { key: "mn-admin-1305", jurisdiction: "MN", source: "mn-1305", kind: "administers", authority: "Minn. R. ch. 1305", url: "https://www.revisor.mn.gov/rules/1305/", effective: "2020-03-31", localConfirmation: true, scope: MN_LOCAL, status: "verified", evidenceFrom: "dli:mn-dli-building-code" },
  { key: "mn-admin-1309", jurisdiction: "MN", source: "mn-1309", kind: "administers", authority: "Minn. R. ch. 1309", url: "https://www.revisor.mn.gov/rules/1309/", effective: "2020-03-31", localConfirmation: true, scope: MN_LOCAL, status: "verified", evidenceFrom: "dli:mn-dli-building-code" },
  { key: "mn-admin-1346", jurisdiction: "MN", source: "mn-1346", kind: "administers", authority: "Minn. R. ch. 1346", url: "https://www.revisor.mn.gov/rules/1346/", effective: "2020-04-06", localConfirmation: true, scope: MN_LOCAL, status: "verified", evidenceFrom: "dli:mn-dli-building-code" },
  // Residential energy code: the rule text is verified; its effective date is not on file yet.
  { key: "mn-admin-1322", jurisdiction: "MN", source: "mn-1322", kind: "administers", authority: "Minn. R. ch. 1322", url: "https://www.revisor.mn.gov/rules/1322/", localConfirmation: true, scope: MN_LOCAL, status: "verified", evidenceFrom: "mn:1322.0010" },
  // Electrical: statewide rule ("All new electrical wiring ... must comply"), effective Aug. 17, 2026 per the Board of Electricity.
  { key: "mn-admin-1315", jurisdiction: "MN", source: "mn-1315", kind: "administers", authority: "Minn. R. 1315.0200", url: "https://www.revisor.mn.gov/rules/1315.0200/", effective: "2026-08-17", localConfirmation: false, scope: "Applies statewide to new electrical wiring, apparatus and equipment. Permits filed before Aug. 17, 2026 follow the 2023 NEC.", status: "verified", evidenceFrom: "dli:mn-dli-electrical" },

  { key: "mn-irc-2018", jurisdiction: "MN", source: "irc-2018", kind: "adopts", authority: "Minn. R. 1309.0010", url: "https://www.revisor.mn.gov/rules/1309.0010/", effective: "2020-03-31", localConfirmation: true, trades: [], status: "verified", evidenceFrom: "mn:1309.0010",
    scope: "IRC chapters 2 to 10 and 44, section P2904, Appendix K and Appendix Q apply where the municipality adopted the State Building Code. Chapter 1 is replaced by Minn. R. 1300; chapter 11 (energy) by Minn. R. 1322 and 1323; mechanical chapters by 1346; plumbing chapters by 4714 (except P2904); electrical chapters by 1315 (R314 and R315 stay). " + MN_LOCAL },
  { key: "mn-ibc-2018", jurisdiction: "MN", source: "ibc-2018", kind: "adopts", authority: "Minn. R. 1305.0011", url: "https://www.revisor.mn.gov/rules/1305.0011/", effective: "2020-03-31", localConfirmation: true, status: "verified", evidenceFrom: "mn:1305.0011", scope: MN_LOCAL },
  { key: "mn-imc-2018", jurisdiction: "MN", source: "imc-2018", kind: "adopts", authority: "Minn. R. 1346.0050", url: "https://www.revisor.mn.gov/rules/1346.0050/", effective: "2020-04-06", localConfirmation: true, status: "verified", evidenceFrom: "mn:1346.0050", scope: "IMC chapters 2 to 15 as amended in Minn. R. ch. 1346. " + MN_LOCAL },
  { key: "mn-iecc-2012", jurisdiction: "MN", source: "iecc-2012", kind: "adopts", authority: "Minn. R. 1322.0010", url: "https://www.revisor.mn.gov/rules/1322.0010/", localConfirmation: true, status: "verified", evidenceFrom: "mn:1322.0010", scope: "Residential provisions, chapters 2(RE) to 5(RE), as amended in Minn. R. ch. 1322. Effective date not yet verified. " + MN_LOCAL },
  { key: "mn-nec-2026", jurisdiction: "MN", source: "nec-2026", kind: "adopts", authority: "Minn. R. 1315.0200, subp. 1a", url: "https://www.revisor.mn.gov/rules/1315.0200/", effective: "2026-08-17", localConfirmation: false, status: "verified", evidenceFrom: "dli:mn-dli-electrical", scope: "Statewide. Electrical permits filed on or after Aug. 17, 2026 must comply with the 2026 NEC." },
  { key: "mn-nec-2023", jurisdiction: "MN", source: "nec-2023", kind: "adopts", authority: "Minn. R. 1315.0200 (prior version)", url: "https://www.dli.mn.gov/business/electrical-contractors", expires: "2026-08-17", localConfirmation: false, status: "verified", evidenceFrom: "dli:mn-dli-electrical", scope: "Applied to electrical permits filed before Aug. 17, 2026." },
];

/** Plain-language summaries written from the cited text (keys: "<section>" or "<section>(<paragraph>)" or "mn:<part>:<subp>"). */
export const SUMMARIES: Record<string, string> = {
  "1926.501(b)": "Employers must protect workers from falls of 6 feet or more to a lower level, using guardrails, safety nets or personal fall arrest systems, with specific options for leading edges, holes, low-slope and steep roofs, and residential construction (where a written fall protection plan is allowed only when the employer can show the usual systems are infeasible or more hazardous).",
  "1926.501(a)": "Sets out when employers must provide fall protection and that the systems must meet 29 CFR 1926.502.",
  "1926.502(b)": "Guardrail systems: the top edge of the top rail must be 42 inches, plus or minus 3 inches, above the walking/working level, with midrails or equivalent and strength requirements.",
  "1926.502(d)": "Personal fall arrest systems: anchorages, connectors, harnesses and lanyards must meet strength and use requirements, and the system must limit free fall and arrest forces.",
  "1926.502(k)": "A fall protection plan is an option only for leading-edge work, precast concrete erection or residential construction when the employer can show conventional fall protection is infeasible or creates a greater hazard. It must be written by a qualified person and kept at the job site.",
  "1926.503": "Employers must train each worker who might be exposed to fall hazards, by a competent person, and keep a written certification of that training.",
  "1926.1053(b)": "Ladder use: when a portable ladder is used to reach an upper landing, its side rails must extend at least 3 feet above the landing, or the ladder must be secured at the top with a grab device. Other rules cover loads, angles, footing and inspection.",
  "1926.1053(a)": "Ladder construction: load capacities, rung spacing and other design requirements for portable, fixed and job-made ladders.",
  "1926.1052(a)": "Construction stairways (the ones workers use during construction): landing size, a 30 to 50 degree slope, and riser heights and tread depths that are uniform within each flight, varying no more than 1/4 inch. These are worker-safety rules, not the building code rules for the finished home.",
  "1926.1052(c)": "Construction stairways with four or more risers or more than 30 inches of rise need at least one handrail and stairrails on unprotected sides, with height and strength requirements.",
  "1926.652(a)": "Workers in an excavation must be protected from cave-ins by an adequate protective system unless the excavation is entirely in stable rock, or is less than 5 feet deep and a competent person finds no indication of a potential cave-in.",
  "1926.651(b)": "Before digging, the estimated location of underground utilities must be determined, and utility companies contacted within established or customary local response times.",
  "1926.651(k)": "A competent person must inspect excavations, adjacent areas and protective systems daily before work starts and as needed, and after rainstorms or other hazard-increasing events.",
  "1926.404(b)": "On construction sites, temporary 120-volt, single-phase 15- and 20-amp receptacles in use by employees need GFCI protection, or the employer must run an assured equipment grounding conductor program.",
  "1926.451(g)": "Workers on a scaffold more than 10 feet above a lower level must be protected from falling, with the type of protection depending on the scaffold.",
  "1926.21": "Employers must instruct each employee to recognize and avoid unsafe conditions and the regulations that apply to their work.",
  "1926.100": "Workers exposed to head injury from impact, falling or flying objects, or electrical shock must wear protective helmets.",
  "1926.62(a)": "The OSHA lead standard applies to all construction work where workers may be exposed to lead, including demolition, removal, renovation and painting work on lead-containing materials.",
  "1926.1101(a)": "The OSHA asbestos standard applies to construction work involving asbestos, including demolition, removal, renovation and repair of materials that contain asbestos.",
  "1926.1153(a)": "The silica standard applies to all occupational exposures to respirable crystalline silica in construction work, except where exposure will stay below 25 micrograms per cubic meter as an 8-hour time-weighted average under any foreseeable conditions.",
  "1926.1153(c)": "Employers can comply by fully following the engineering controls, work practices and respirator rules listed for each task in Table 1 (for example, water delivery or vacuum dust collection on saws and grinders).",
  "1904.1": "Companies with 10 or fewer employees at all times during the last calendar year generally don't need to keep OSHA injury and illness records unless told to in writing, but every covered employer must still report serious incidents under 1904.39.",
  "1904.39(a)": "Report a work-related fatality to OSHA within 8 hours, and an in-patient hospitalization, amputation or loss of an eye within 24 hours.",
  "745.82": "The federal RRP rule applies to renovations for compensation in target housing and child-occupied facilities, except where the affected components were found free of lead-based paint by a certified inspector or risk assessor, by a certified renovator using an EPA-recognized test kit, or by an EPA-recognized lab testing paint chips (other listed exceptions apply).",
  "745.84(a)": "No more than 60 days before renovating a dwelling unit in target housing, the firm must give the owner EPA's lead pamphlet and keep proof (acknowledgment or mailing certificate).",
  "745.85(a)": "Covered renovations must be done by certified firms using certified renovators, with warning signs, containment, restricted practices and cleaning as listed.",
  "745.89(a)": "Firms that perform renovations for compensation must apply electronically to EPA for firm certification and pay the fee.",
  "391.11": "A person may not drive a commercial motor vehicle unless qualified: for example at least 21 years old (with exceptions), able to read and speak English sufficiently, physically qualified, licensed, and having passed a road test or equivalent.",
  "396.17(a)": "Every commercial motor vehicle (each unit of a combination) must be inspected under this section, covering at least the items in Appendix A to Part 396.",
  "382.103": "Drug and alcohol testing rules apply to employers and drivers who operate a commercial motor vehicle in commerce and are subject to the CDL requirements of Part 383. A self-employed driver must meet both the employer and the driver requirements.",
  "mn:1300.0120:1": "In Minnesota, the owner or authorized agent must apply to the building official and get a permit before constructing, altering, repairing, moving or demolishing a regulated building or system, where the code is in force.",
  "mn:1300.0120:4": "Lists work exempt from a building permit in Minnesota, for example one-story detached accessory structures up to 200 square feet, fences up to 7 feet high, and decks or platforms no more than 30 inches above grade that aren't attached to a structure with frost footings and aren't part of an accessible route. Exempt work must still meet the code.",
  "mn:1300.0120:11": "A Minnesota permit expires unless the authorized work starts within 180 days after it is issued. The building official grants written extensions of up to 180 days each for justifiable cause.",
  "mn:1309.0311:2": "Minnesota replaces IRC R311.7.1: all stairways serving a dwelling or accessory structure, including exterior stairs to grade and stairs serving decks, porches and balconies, must meet the stair section, with a 36-inch minimum clear width and handrail projection limits.",
  "mn:1309.0311:3": "Minnesota amends IRC R311.7.2: minimum stairway headroom is 6 feet 8 inches, with listed exceptions.",
  "mn:1309.0311:1": "Minnesota amends IRC R311.3.2: doors other than the required egress door need a landing or floor no more than 7-3/4 inches below the threshold, with an exception for exterior stairways under 30 inches.",
  "mn:1309.0312:1": "Minnesota amends IRC R312.1.1: guards are required along open sides of floors, stairs, ramps and landings more than 30 inches above the floor or grade below. Insect screening is not a guard.",
  "mn:1309.0312:2": "Minnesota amends the IRC window fall protection section (R312.2).",
  "mn:1309.0403:1": "Minnesota amends IRC R403.1.4.1 (frost protection): footings can't bear on frozen soil, and permanent supports must be protected from frost by one of the listed methods.",
  "mn:1309.0403:2": "Minnesota amends IRC R403.1.6 (foundation anchorage): anchor bolt size, spacing and placement for sill and sole plates.",
  "mn:1309.0507:1": "Minnesota replaces IRC Table R507.3.1 (minimum deck footing size by soil bearing value, live load and tributary area). The table doesn't display well as text here: open the official source.",
  "mn:1309.0507:4": "Minnesota replaces IRC Table R507.9.1.3(1) (deck ledger connection). Open the official source to read the table.",
  "mn:1309.0905:1": "Minnesota amends IRC R905.2.1: asphalt shingles must be fastened to solidly sheathed decks or 1-inch nominal wood boards.",
  "mn:1309.0905:2": "Minnesota deletes IRC R905.2.8.5.",
  "mn:1309.0903:1": "Minnesota amends IRC R903.2.1: flashing at wall and roof intersections, slope changes and roof openings, plus kick-out flashing where a sloped roof eave meets a sidewall (required when re-siding, not when only re-roofing).",
  "mn:1309.0010:1": "Minnesota adopts the 2018 IRC by reference as part of the Minnesota State Building Code, as qualified by Minn. R. ch. 1300 and amended in ch. 1309.",
  "mn:1309.0010:3": "Minnesota deletes and replaces several IRC chapters: administration (ch. 1), energy (ch. 11), mechanical (ch. 12 to 24), plumbing (ch. 25 to 33, except P2904) and electrical (ch. 34 to 43, except R314 and R315).",
  "mn:1305.0011:1": "Minnesota adopts the 2018 IBC by reference as part of the Minnesota State Building Code, as qualified by Minn. R. ch. 1300 and amended in ch. 1305.",
  "mn:1315.0200:1a": "Minnesota requires new electrical wiring, apparatus and equipment to comply with the 2026 NEC (ANSI/NFPA 70-2026), Minn. Stat. 326B.35 and the State Building Code.",
  "mn:1322.0010:1": "Minnesota adopts chapters 2(RE) to 5(RE) of the residential provisions of the 2012 IECC by reference, as amended in Minn. R. ch. 1322.",
  "mn:1346.0050:1": "Minnesota adopts chapters 2 to 15 of the 2018 IMC as part of the Minnesota Mechanical Code, as amended in Minn. R. ch. 1346.",
};

/** Which model code a Minnesota chapter amends. */
export const MN_AMENDS: Record<string, string | null> = { "1300": null, "1305": "ibc-2018", "1309": "irc-2018", "1315": "nec-2026", "1322": "iecc-2012", "1346": "imc-2018" };

/** IRC 2018 section titles for navigation. Seeded as pending_review (titles only, no requirement text) until checked against the publication. */
export const IRC_TITLES: { section: string; title: string; trades: string[]; topics: string[] }[] = [
  { section: "R105", title: "Permits", trades: [], topics: ["permits"] },
  { section: "R301", title: "Design criteria", trades: ["framing", "roofing", "general-contracting"], topics: ["design loads", "snow load", "wind"] },
  { section: "R308", title: "Glazing", trades: ["windows-doors"], topics: ["safety glazing", "tempered glass"] },
  { section: "R310", title: "Emergency escape and rescue openings", trades: ["windows-doors", "basements"], topics: ["egress window", "egress"] },
  { section: "R311.7", title: "Stairways", trades: ["decks", "framing", "interior-remodeling", "basements", "additions"], topics: ["stairways", "stairs", "stair riser", "stair tread", "handrail", "deck stairs"] },
  { section: "R312", title: "Guards and window fall protection", trades: ["decks", "framing", "windows-doors"], topics: ["guards", "guardrail", "deck guard"] },
  { section: "R314", title: "Smoke alarms", trades: ["electrical", "interior-remodeling"], topics: ["smoke alarms"] },
  { section: "R315", title: "Carbon monoxide alarms", trades: ["electrical", "hvac", "interior-remodeling"], topics: ["carbon monoxide alarms"] },
  { section: "R317", title: "Protection of wood and wood-based products against decay", trades: ["decks", "framing"], topics: ["treated lumber", "decay"] },
  { section: "R403", title: "Footings", trades: ["concrete", "foundations", "decks"], topics: ["footings", "frost depth"] },
  { section: "R507", title: "Exterior decks", trades: ["decks"], topics: ["decks", "deck ledger", "deck footings", "deck joists"] },
  { section: "R602", title: "Wood wall framing", trades: ["framing"], topics: ["wall framing", "headers", "studs"] },
  { section: "R703", title: "Exterior covering", trades: ["siding"], topics: ["siding", "exterior covering", "water-resistive barrier"] },
  { section: "R806", title: "Roof ventilation", trades: ["roofing", "insulation"], topics: ["attic ventilation", "roof ventilation"] },
  { section: "R903", title: "Weather protection", trades: ["roofing"], topics: ["roof flashing", "weather protection"] },
  { section: "R905", title: "Requirements for roof coverings", trades: ["roofing"], topics: ["roof coverings", "shingles", "underlayment", "ice barrier", "shingle fasteners"] },
  { section: "R908", title: "Reroofing", trades: ["roofing"], topics: ["reroofing", "roof overlay", "tear-off"] },
];

/** Approved terminology dictionary: everyday words to the topics used on sections. It never says two rules are the same. */
export const TERMS: { term: string; synonyms: string[]; topics: string[]; related: string[]; trades?: string[]; note?: string }[] = [
  { term: "riser", synonyms: ["stair height", "step height", "rise", "risers"], topics: ["stairways", "stair riser", "deck stairs"], related: ["tread", "handrail", "guard", "headroom"], note: "Building-code stair rules (IRC R311.7 and state amendments) cover the finished building. OSHA 29 CFR 1926.1052 covers temporary stairways workers use during construction. They are different requirements." },
  { term: "tread", synonyms: ["stair depth", "step depth", "treads", "tread depth"], topics: ["stairways", "stair tread", "deck stairs"], related: ["riser", "handrail", "nosing"] },
  { term: "stairs", synonyms: ["stair", "stairway", "steps", "staircase"], topics: ["stairways", "stairs", "deck stairs"], related: ["riser", "tread", "handrail", "guard", "headroom"] },
  { term: "handrail", synonyms: ["hand rail", "stair rail", "railing on stairs"], topics: ["handrail", "stairways", "stair rail"], related: ["guard", "stairs"] },
  { term: "guard", synonyms: ["guardrail", "guard rail", "deck railing", "railing height", "railing"], topics: ["guards", "guardrail", "deck guard"], related: ["handrail", "fall protection"], note: "A building-code guard (IRC R312) protects occupants of the finished building. An OSHA guardrail (29 CFR 1926.502) protects workers during construction." },
  { term: "deck", synonyms: ["decks", "porch", "patio deck"], topics: ["decks", "deck stairs", "deck guard", "deck footings", "deck ledger"], related: ["footing", "ledger", "guard", "stairs"], trades: ["decks"] },
  { term: "ledger", synonyms: ["ledger board", "deck ledger"], topics: ["deck ledger", "decks"], related: ["deck", "flashing"] },
  { term: "footing", synonyms: ["footings", "frost depth", "frost footing", "pier", "frost line"], topics: ["footings", "frost depth", "frost protection", "deck footings"], related: ["deck", "foundation"] },
  { term: "headroom", synonyms: ["head room", "head clearance"], topics: ["headroom", "stairways"], related: ["stairs"] },
  { term: "landing", synonyms: ["landings", "door landing", "threshold"], topics: ["exterior door landing", "stairways"], related: ["stairs"] },
  { term: "shingle", synonyms: ["shingles", "asphalt shingle", "fastener pattern", "nailing pattern", "roof nails"], topics: ["roof coverings", "shingles", "shingle fasteners"], related: ["underlayment", "ice barrier", "flashing"], trades: ["roofing"] },
  { term: "underlayment", synonyms: ["felt", "synthetic underlayment", "ice and water", "ice barrier", "ice dam"], topics: ["underlayment", "ice barrier", "roof coverings"], related: ["shingle", "flashing"], trades: ["roofing"] },
  { term: "flashing", synonyms: ["kick-out", "kickout", "step flashing", "drip edge"], topics: ["roof flashing", "weather protection", "flashing"], related: ["siding", "shingle"] },
  { term: "siding", synonyms: ["house wrap", "housewrap", "wrb", "weather barrier", "lap siding", "vinyl siding"], topics: ["siding", "exterior covering", "water-resistive barrier"], related: ["flashing"], trades: ["siding"] },
  { term: "permit", synonyms: ["permits", "building permit", "do i need a permit", "exempt from permit"], topics: ["permits", "permit required", "work exempt from permit", "building permit"], related: ["inspection"] },
  { term: "inspection", synonyms: ["inspections", "inspector", "final inspection"], topics: ["inspections", "permits"], related: ["permit"], note: "Required inspections are set by the local building official and the adopted code's administration chapter. Built2Bid shows what the cited text says, not a universal list." },
  { term: "gfci", synonyms: ["ground fault", "gfi", "temporary power", "extension cord"], topics: ["gfci", "ground fault", "temporary power"], related: ["electrical code"] },
  { term: "electrical code", synonyms: ["nec", "national electrical code", "nfpa 70", "wiring code"], topics: ["nec", "electrical code", "minnesota electrical code"], related: ["gfci"], trades: ["electrical"] },
  { term: "fall protection", synonyms: ["harness", "tie off", "tie-off", "6 feet", "six feet", "roof safety", "guardrails on site"], topics: ["fall protection", "personal fall arrest", "guardrail height", "residential construction", "steep roof", "low-slope roof", "roof edge"], related: ["ladder", "scaffold", "guard"] },
  { term: "ladder", synonyms: ["ladders", "extension ladder", "step ladder", "3 feet above"], topics: ["ladders", "ladder", "extension ladder", "ladder side rails"], related: ["fall protection"] },
  { term: "scaffold", synonyms: ["scaffolds", "scaffolding", "pump jack", "staging"], topics: ["scaffold", "scaffolding"], related: ["fall protection"] },
  { term: "trench", synonyms: ["trenches", "excavation", "digging", "cave-in", "shoring", "trench box"], topics: ["excavation", "trench", "trench protection", "shoring", "sloping", "trench box"], related: ["call before you dig"] },
  { term: "call before you dig", synonyms: ["811", "locate utilities", "utility locate", "underground utilities"], topics: ["utilities", "call before you dig", "excavation"], related: ["trench"] },
  { term: "silica", synonyms: ["concrete dust", "cutting concrete", "grinding", "table 1"], topics: ["silica", "concrete cutting", "dust control", "respirator"], related: [] },
  { term: "lead paint", synonyms: ["lead", "rrp", "pre-1978", "lead safe", "lead-safe", "renovate right"], topics: ["lead paint", "rrp", "pre-1978", "lead-safe work practices", "lead firm certification", "renovate right", "lead"], related: [] },
  { term: "asbestos", synonyms: ["popcorn ceiling", "vermiculite", "transite"], topics: ["asbestos"], related: [] },
  { term: "cdl", synonyms: ["commercial driver", "dot", "dot number", "commercial vehicle", "truck", "trailer", "driver qualification"], topics: ["dot", "cdl", "driver qualification", "commercial driver", "commercial vehicle", "vehicle inspection"], related: ["drug testing"], note: "DOT rules depend on vehicle weight ratings, cargo, passengers and interstate or intrastate operation, not on the trade." },
  { term: "drug testing", synonyms: ["drug test", "alcohol test", "random testing"], topics: ["drug testing", "alcohol testing"], related: ["cdl"] },
  { term: "energy code", synonyms: ["insulation", "r-value", "iecc", "air sealing"], topics: ["energy code", "iecc", "residential energy"], related: [] },
  { term: "mechanical code", synonyms: ["imc", "hvac code", "furnace", "ductwork"], topics: ["mechanical code", "imc"], related: [] },
  { term: "window fall protection", synonyms: ["window opening control", "window guard"], topics: ["window fall protection"], related: ["guard"] },
  { term: "egress", synonyms: ["egress window", "escape window", "bedroom window"], topics: ["egress window", "egress"], related: [] },
  { term: "hard hat", synonyms: ["helmet", "head protection", "ppe", "safety glasses", "eye protection"], topics: ["hard hat", "head protection", "ppe", "eye protection", "personal protective equipment"], related: [] },
  { term: "osha reporting", synonyms: ["report injury", "report to osha", "fatality", "hospitalization", "osha 300", "injury log"], topics: ["reporting", "injury reporting", "recordkeeping", "osha 300 log", "small employer"], related: [] },
  { term: "safety training", synonyms: ["training", "toolbox talk", "competent person"], topics: ["training", "safety training", "fall protection training", "competent person"], related: [] },
];

export const JURISDICTIONS = [
  { id: "US", level: "federal", state: null as string | null, name: "United States (federal)", sort: 0 },
  ...Object.entries(US_STATES).filter(([c]) => !["PR", "VI", "GU"].includes(c)).sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name], i) => ({ id: code, level: "state", state: code, name, sort: 10 + i })),
];
