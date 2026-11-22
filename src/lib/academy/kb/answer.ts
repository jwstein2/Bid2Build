/**
 * How search results are presented (pure, client-safe). A "Quick Answer" is only ever the cited, verified section that
 * matched the question on its section number or on approved terminology; everything else is shown as related
 * material, and when nothing qualifies the page shows KB_UNVERIFIED instead of an answer.
 */
import type { KbResult } from "./types";

export type ResultGroup = "building" | "safety" | "transport" | "environment" | "adoption";

export const GROUP_LABEL: Record<ResultGroup, { title: string; note: string }> = {
  building: { title: "Building codes", note: "What the adopted building, residential, electrical, mechanical or energy code requires." },
  adoption: { title: "Adoption and administration", note: "Which edition applies, when it took effect and who enforces it." },
  safety: { title: "Worker safety (OSHA)", note: "Rules that protect workers on the job. They do not replace the building code for the finished work." },
  transport: { title: "Vehicles and drivers (DOT)", note: "Commercial vehicle rules. Whether they apply depends on the vehicle and the trip, not the trade." },
  environment: { title: "Environmental rules (EPA)", note: "Federal environmental work-practice rules." },
};

export function groupFor(r: Pick<KbResult, "family_slug" | "kind">): ResultGroup {
  if (r.family_slug.startsWith("osha")) return "safety";
  if (r.family_slug === "fmcsa") return "transport";
  if (r.family_slug.startsWith("epa")) return "environment";
  if (r.kind === "administrative" || r.kind === "scope") return "adoption";
  return "building";
}

const ORDER: ResultGroup[] = ["building", "adoption", "safety", "environment", "transport"];

export function groupResults(results: KbResult[]): { group: ResultGroup; items: KbResult[] }[] {
  const by = new Map<ResultGroup, KbResult[]>();
  for (const r of results) {
    const g = groupFor(r);
    by.set(g, [...(by.get(g) ?? []), r]);
  }
  return ORDER.filter((g) => by.has(g)).map((g) => ({ group: g, items: by.get(g)! }));
}

/** Matches strong enough to answer: the exact section asked for, or a section tagged with the approved term asked about. */
const STRONG = new Set(["exact_section", "section_prefix", "terminology"]);
/** A verified section must also be in force where the visitor is (or the visitor picked no state, for federal rules). */
const ANSWERABLE = new Set(["verified_applicable", "jurisdiction_confirmation_needed"]);

/**
 * The Quick Answer must answer the question that was asked: it has to come from the same kind of rule as the best
 * match overall. "Deck stair riser height" best matches the residential code, so an OSHA rule for temporary jobsite
 * stairs is shown as related material, never as the answer.
 */
export function pickAnswer(results: KbResult[]): KbResult | null {
  const lead = [...results].sort((a, b) => b.rank - a.rank)[0];
  if (!lead) return null;
  const top = results.find((r) => r.section_status === "verified" && r.body_kind !== "title_only" && STRONG.has(r.match) && r.rank >= 3
    && ANSWERABLE.has(r.applicability?.status) && groupFor(r) === groupFor(lead));
  return top ?? null;
}

/** What the results page should show. Missing data, empty results and real failures are never the same message. */
export type SearchOutcome = "idle" | "error" | "answer" | "reference" | "no_match";
export function searchOutcome(search: { ok: boolean; results: KbResult[] } | null): SearchOutcome {
  if (!search) return "idle";
  if (!search.ok) return "error";
  if (!search.results.length) return "no_match";
  return pickAnswer(search.results) ? "answer" : "reference";
}

/** The kind of code the question is about (from the best match), so the page can list the matching statewide codes. */
export function leadCategory(results: KbResult[]): CodeCategory | null {
  const lead = [...results].sort((a, b) => b.rank - a.rank)[0];
  return lead ? categoryFor(lead.family_slug, lead.source_title) : null;
}

/** One plain status per result for visitors. Detailed review flags stay in the admin pages. */
export interface DisplayStatus { label: string; tone: "ok" | "brand" | "neutral"; help: string }
export function displayStatus(r: Pick<KbResult, "applicability" | "section_status" | "body_kind" | "source_jurisdiction">, state: string | null): DisplayStatus {
  const a = r.applicability?.status;
  if (r.section_status !== "verified" || r.body_kind === "title_only") {
    if (a === "not_adopted" || a === "superseded") return STATUS.historical;
    return STATUS.review;
  }
  switch (a) {
    case "verified_applicable": return STATUS.verified;
    case "jurisdiction_confirmation_needed":
      return state && r.source_jurisdiction === state ? STATUS.statewide : STATUS.local;
    case "not_adopted": return STATUS.reference;
    case "superseded": return STATUS.historical;
    case "source_review_needed": return STATUS.review;
    default: return STATUS.reference;
  }
}
export const STATUS: Record<"verified" | "statewide" | "local" | "historical" | "review" | "reference", DisplayStatus> = {
  verified: { label: "Verified for Selected Jurisdiction", tone: "ok", help: "The adopted requirement and the jurisdiction were confirmed from the official sources below." },
  statewide: { label: "Statewide Source Available", tone: "brand", help: "Verified statewide. Your city, township or county may add local amendments; confirm with them." },
  local: { label: "Local Verification Needed", tone: "brand", help: "Verified at the state or federal level. Your local permitting office may adopt or amend it differently." },
  historical: { label: "Historical Edition", tone: "neutral", help: "A different edition from the one in force here. Shown for reference only." },
  review: { label: "Under Review", tone: "neutral", help: "On file, but the text or how it applies here hasn't been fully verified yet." },
  reference: { label: "Official Reference Only", tone: "neutral", help: "Use the official source to read the requirement." },
};

/** Code categories shown under "Available codes" (spec list), from the family or a state-written code's title. */
export type CodeCategory = "residential" | "building" | "electrical" | "plumbing" | "mechanical" | "energy" | "fire" | "existing" | "green" | "safety" | "other";
export const CATEGORY_LABEL: Record<CodeCategory, string> = {
  residential: "Residential", building: "Building", electrical: "Electrical", plumbing: "Plumbing", mechanical: "Mechanical / fuel gas", energy: "Energy",
  fire: "Fire", existing: "Existing buildings", green: "Green building", safety: "Worker safety", other: "Other",
};
export const CATEGORY_ORDER: CodeCategory[] = ["residential", "building", "electrical", "plumbing", "mechanical", "energy", "fire", "existing", "green", "safety", "other"];
const FAMILY_CATEGORY: Record<string, CodeCategory> = {
  irc: "residential", ibc: "building", nec: "electrical", ipc: "plumbing", upc: "plumbing", imc: "mechanical", umc: "mechanical", ifgc: "mechanical", nfpa54: "mechanical",
  iecc: "energy", ashrae_90_1: "energy", ifc: "fire", nfpa1: "fire", iebc: "existing", osha_construction: "safety", osha_state_plans: "safety", osha_recordkeeping: "safety",
};
export function categoryFor(family: string, title?: string | null): CodeCategory {
  if (FAMILY_CATEGORY[family]) return FAMILY_CATEGORY[family];
  const t = (title ?? "").toLowerCase();
  if (/green|calgreen/.test(t)) return "green";
  if (/energy/.test(t)) return "energy";
  if (/plumbing/.test(t)) return "plumbing";
  if (/electric/.test(t)) return "electrical";
  if (/mechanical|fuel gas/.test(t)) return "mechanical";
  if (/fire/.test(t)) return "fire";
  if (/existing/.test(t)) return "existing";
  if (/residential|dwelling/.test(t)) return "residential";
  if (/building/.test(t)) return "building";
  return "other";
}

/** Whether the search counts as answered for the anonymous trend stats (same rule as the page). */
export const isAnswered = (results: KbResult[]) => pickAnswer(results) !== null;
