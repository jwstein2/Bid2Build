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

export function pickAnswer(results: KbResult[]): KbResult | null {
  const top = results.find((r) => r.section_status === "verified" && r.body_kind !== "title_only" && STRONG.has(r.match) && r.rank >= 3
    && ANSWERABLE.has(r.applicability?.status));
  return top ?? null;
}

/** Whether the search counts as answered for the anonymous trend stats (same rule as the page). */
export const isAnswered = (results: KbResult[]) => pickAnswer(results) !== null;
