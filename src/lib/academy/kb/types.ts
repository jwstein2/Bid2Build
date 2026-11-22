/**
 * Academy knowledge engine: shared types, labels and rules (safe for client and server).
 * Schema: supabase/migrations/20270220001000_academy_knowledge.sql. Overview: docs/academy/expansion/README.md.
 */

export const KB_DISCLAIMER =
  "Educational information only. Building codes and licensing requirements vary by jurisdiction and may change. Verify requirements with the applicable authority having jurisdiction before beginning work.";

export const KB_UNVERIFIED =
  "Unable to verify the applicable requirement from the available official sources. Confirm with your local building department or authority having jurisdiction.";

/** Documented applicability statuses returned by academy_kb_applicability(). Never a model's confidence score. */
export type Applicability =
  | "verified_applicable"
  | "jurisdiction_confirmation_needed"
  | "source_review_needed"
  | "not_adopted"
  | "superseded"
  | "unavailable";

export const APPLICABILITY: Record<Applicability, { label: string; tone: "ok" | "warn" | "muted" | "danger"; help: string }> = {
  verified_applicable: {
    label: "Verified Applicable", tone: "ok",
    help: "The adopted requirement and the jurisdiction were confirmed from the official sources listed below.",
  },
  jurisdiction_confirmation_needed: {
    label: "Jurisdiction Confirmation Needed", tone: "warn",
    help: "Verified at the state or federal level, but your city, county or other permitting authority may adopt, enforce or amend it differently. Confirm with them.",
  },
  source_review_needed: {
    label: "Source Review Needed", tone: "warn",
    help: "Related material is on file, but its text, edition or adoption has not been fully verified for your location yet.",
  },
  not_adopted: {
    label: "Different Edition Adopted", tone: "muted",
    help: "Your jurisdiction enforces a different edition of this code. Shown for reference only.",
  },
  superseded: {
    label: "Superseded", tone: "muted",
    help: "An older edition kept for history. It is not the current requirement here.",
  },
  unavailable: {
    label: "Unavailable", tone: "danger",
    help: "Reliable supporting material for this location could not be established.",
  },
};

export const REASON_TEXT: Record<string, string> = {
  verified: "Verified from the official source.",
  local_not_selected: "Which city, county or township is the project in? Pick it under \u201cWhere is the project?\u201d to check.",
  local_verified: "Your city or township enforces the state code (confirmed from the state's official directory).",
  local_not_enforced: "Your city or township has not adopted the state building code for local enforcement. The state code still applies; check with the county or state about permits.",
  local_not_verified: "Your local authority's adoption has not been verified yet.",
  state_rules_may_differ: "Federal rule. State programs can add to it or run their own version.",
  state_plan: "Your state runs an OSHA-approved State Plan. Its standards govern and must be at least as effective as the federal rule shown.",
  section_not_verified: "The section text has not been verified yet.",
  adoption_not_verified: "Adoption in this state has not been verified yet.",
  source_not_verified: "The publication has not been verified yet.",
  not_yet_effective: "Adopted, but not in effect yet.",
  state_enforces_other_edition: "This state enforces a different edition.",
  other_jurisdiction: "This rule belongs to another state.",
  official_source_unreachable: "The official source could not be reached at the last check.",
  no_location: "Choose a state to check applicability.",
  superseded: "No longer in force.",
  not_found: "Not found.",
  not_published: "Not published.",
};

export const CONTENT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", pending_review: "Pending Review", verified: "Verified", superseded: "Superseded",
  source_unavailable: "Source Unavailable", archived: "Archived", rejected: "Rejected",
};

export const FEEDBACK_REASONS = [
  { key: "incorrect_requirement", label: "Incorrect requirement" },
  { key: "outdated_code", label: "Outdated code" },
  { key: "wrong_jurisdiction", label: "Wrong jurisdiction" },
  { key: "broken_citation", label: "Broken citation or link" },
  { key: "unclear_explanation", label: "Unclear explanation" },
  { key: "missing_local_amendment", label: "Missing local amendment" },
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["key"];

export const RIGHTS_LABEL: Record<string, string> = {
  public_domain: "Public domain (U.S. Government work)",
  government_edict: "Official government text (law)",
  licensed: "Licensed",
  free_read_only: "Publisher's free read-only access (not reproduced here)",
  metadata_only: "Citation and link only",
};

export interface KbResult {
  section_id: string; source_id: string; citation: string; section_number: string; title: string; kind: string; body_kind: string;
  body: string | null; summary: string | null; exceptions: string | null; page: string | null; trades: string[]; topics: string[];
  official_url: string | null; section_status: string; last_verified_at: string | null; source_title: string; source_short: string;
  edition: string; family_slug: string; family_name: string; publisher: string; rights: string; read_url: string | null;
  source_jurisdiction: string | null; pagination_note: string | null; amends_section: string | null; amend_action: string | null;
  applicability: { status: Applicability; reason?: string; authority?: string; effective_date?: string | null; jurisdiction_id?: string; official_url?: string; other_edition?: string; scope_note?: string | null; local?: KbLocalInfo };
  match: string; rank: number;
}

/** Public facts about a local permitting authority (academy_kb_local_info). No personal names are stored. */
export interface KbLocalInfo {
  id: string; name: string; kind?: string; county?: string; status?: "enforces" | "not_enforced" | "unknown"; phone?: string;
  detail?: { electrical?: "state" | "local"; accessibility?: "local" | "county"; opt_1306_2?: boolean; opt_1306_3?: boolean; plumbing_inspects?: boolean };
  source_url?: string; verified_at?: string;
}

export interface KbLocation {
  zip: string | null;
  state: string | null;
  /** A verified local jurisdiction id like "MN:rochester" (only when the user picked one). */
  local: string | null;
  trade: string | null;
  /** Where the default came from (shown so the user knows why it was chosen). */
  from: "saved" | "business" | "academy_profile" | "none";
}

/** Plain-language citation users can copy. */
export function citationText(r: Pick<KbResult, "citation" | "source_short" | "edition" | "page" | "official_url" | "last_verified_at">): string {
  const parts = [r.citation, r.edition && !r.citation.includes(r.edition) ? `(${r.source_short} ${r.edition})` : null, r.page ? `p. ${r.page}` : null].filter(Boolean);
  const verified = r.last_verified_at ? ` Last verified ${r.last_verified_at.slice(0, 10)}.` : "";
  return `${parts.join(" ")}.${r.official_url ? ` ${r.official_url}` : ""}${verified}`;
}

/** Search-box parsing: pull a section number like "R311.7.5", "1926.501(b)(13)" or "1309.0311" out of a question. */
export function sectionFromQuery(q: string): string | null {
  const m = /(?:^|\s|§)([A-Z]{0,3}\d{2,4}(?:\.\d+)+[a-z]?(?:\([a-z0-9]+\))*)/i.exec(q);
  return m ? m[1] : null;
}

export const QUIZ_SIZES = [5, 10, 20, 25, 50] as const;
