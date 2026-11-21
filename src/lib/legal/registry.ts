/**
 * Legal document registry: the one source of truth for Built2Bid's current published legal documents,
 * their versions and dates, and the legal-review status shown on the site.
 *
 * Rules (owner instruction 2026-11-20, "Legal Documentation Status Update V1"):
 *  - Every current published document defaults to "Published, legal review pending". Nothing here is marked
 *    reviewed: only the owner can change a status, from /admin/legal, and only once counsel has actually
 *    reviewed it. Never add attorney names, approvals or dates that did not happen.
 *  - Dates below are the dates the documents themselves show (or the repository records). Adding the
 *    review notice does NOT change a document's version, effective date or "Last updated" date.
 *  - This file is client-safe: it holds no internal review notes. Owner notes live only in the database
 *    (legal_document_reviews), read by owner pages.
 */

export const LEGAL_STATUSES = ["published_pending", "in_review", "reviewed", "revision_required", "archived"] as const;
export type LegalStatus = (typeof LEGAL_STATUSES)[number];

/** Owner-facing names (admin dashboard). */
export const LEGAL_STATUS_LABELS: Record<LegalStatus, string> = {
  published_pending: "Published — Legal Review Pending",
  in_review: "In Legal Review",
  reviewed: "Reviewed by Legal Counsel",
  revision_required: "Revision Required",
  archived: "Superseded / Archived",
};

/**
 * What customers see. "Revision required" is an internal finding, so the public keeps seeing "review
 * pending" until a revised version is actually published. "In review" and "Reviewed" only show once the
 * owner records them (they are never defaults).
 */
export const PUBLIC_STATUS: Record<LegalStatus, { title: string; subtitle: string }> = {
  published_pending: { title: "Current Published Version", subtitle: "Legal review pending" },
  revision_required: { title: "Current Published Version", subtitle: "Legal review pending" },
  in_review: { title: "Current Published Version", subtitle: "In independent legal review" },
  reviewed: { title: "Current Published Version", subtitle: "Reviewed by independent legal counsel" },
  archived: { title: "Superseded Version", subtitle: "No longer current" },
};

/** Primary status line (owner-approved wording). */
export const PRIMARY_STATUS_LINE = "Current Published Version — Legal Review Pending";

/** Owner-approved explanatory disclosure, shown in full on each legal document and on /legal. */
export const REVIEW_DISCLOSURE = [
  "This document represents the current published version of Built2Bid LLC's applicable policies, terms, or disclosures and is pending review by independent legal counsel.",
  "Built2Bid may revise this document following legal review or as business, regulatory, or operational requirements change. Updates will be published with appropriate version information, and additional notice or consent will be provided where required by applicable law.",
  "Users are encouraged to review the current published terms and policies applicable to their use of the platform.",
] as const;

/** Owner-approved short version for compact interfaces. */
export const SHORT_DISCLOSURE = "Current published policy. Independent legal review pending. Updates will be communicated as required.";

export type LegalCategory = "core" | "program" | "disclosure" | "in_product";
export const LEGAL_CATEGORY_LABELS: Record<LegalCategory, string> = {
  core: "Core policies",
  program: "Program terms",
  disclosure: "Disclosures and security",
  in_product: "In-product agreements and consents",
};

export type RiskPriority = "high" | "medium" | "low";

export interface LegalVersion {
  /** Version identifier as recorded (the document's own date, or the code's version constant). */
  version: string;
  /** What the version was, in plain words. */
  summary: string;
  /** ISO date this version was published, or null when the repository does not record it. */
  publishedOn: string | null;
  /** ISO date it stopped being current, or null for the current version. */
  supersededOn: string | null;
}

export interface LegalDocument {
  key: string;
  name: string;
  category: LegalCategory;
  /** Where people read it. Public pages are absolute paths; in-product items point at where they appear. */
  href: string;
  /** True when anyone can open href without signing in. */
  public: boolean;
  /** Where the text appears, for in-product items (shown to the owner and on /legal). */
  location?: string;
  /** Current version identifier, exactly as the document or code records it. Never reset by this system. */
  version: string;
  /** Effective date as stated in the document, or null when the document states none. */
  effectiveDate: string | null;
  /** First publication of any version, when the repository records it. */
  originalPublication: string | null;
  /** Note on originalPublication when the exact date isn't recorded. */
  originalPublicationNote?: string;
  /** Most recent substantive revision (ISO date). */
  lastRevised: string | null;
  /** Publication date of the current version (ISO date). */
  publishedOn: string | null;
  /** Default status before the owner records anything. Always published_pending unless evidence says otherwise. */
  defaultStatus: LegalStatus;
  /** Priority for counsel (from the 2026-11-19 legal review package). Owner-only. */
  risk: RiskPriority;
  /** Whether people accept it, and whether acceptance is recorded (owner-only context). */
  acceptance: string;
  /** Historical versions, newest first (the current one first). */
  history: LegalVersion[];
}

/** Date every public policy page changed on in the 2026-11-19 legal update (PR #175). */
const LEGAL_UPDATE_2026_11_19 = "2026-11-19";
const LEGAL_UPDATE_2026_11_21 = "2026-11-21";

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    key: "terms", name: "Terms of Service", category: "core", href: "/terms", public: true,
    version: "November 19, 2026", effectiveDate: null, originalPublication: null,
    originalPublicationNote: "An earlier, undated version was live at launch (November 13, 2026).",
    lastRevised: LEGAL_UPDATE_2026_11_19, publishedOn: LEGAL_UPDATE_2026_11_19, defaultStatus: "published_pending", risk: "high",
    acceptance: "Accepted by continuing at sign-in (\"By continuing you agree...\"); no per-user acceptance record or version is stored.",
    history: [
      { version: "November 19, 2026", summary: "Rewritten: liability, disputes, e-signature, AI, Team, automatic renewal and records sections added.", publishedOn: LEGAL_UPDATE_2026_11_19, supersededOn: null },
      { version: "Launch version (undated)", summary: "Short terms: plans, cancellation and refunds, content, acceptable use, customer emails.", publishedOn: null, supersededOn: LEGAL_UPDATE_2026_11_19 },
    ],
  },
  {
    key: "privacy", name: "Privacy Policy", category: "core", href: "/privacy", public: true,
    version: "November 19, 2026", effectiveDate: null, originalPublication: null,
    originalPublicationNote: "An earlier, undated version was live at launch (November 13, 2026).",
    lastRevised: LEGAL_UPDATE_2026_11_19, publishedOn: LEGAL_UPDATE_2026_11_19, defaultStatus: "published_pending", risk: "high",
    acceptance: "Accepted with the Terms at sign-in; no per-user acceptance record or version is stored.",
    history: [
      { version: "November 19, 2026", summary: "Rewritten to match the product: providers, e-signature, HR and tax data, prospect data, ad measurement, account emails.", publishedOn: LEGAL_UPDATE_2026_11_19, supersededOn: null },
      { version: "Launch version (undated)", summary: "Original privacy policy.", publishedOn: null, supersededOn: LEGAL_UPDATE_2026_11_19 },
    ],
  },
  {
    key: "cookies", name: "Cookie Policy", category: "core", href: "/cookies", public: true,
    version: "November 19, 2026", effectiveDate: null, originalPublication: LEGAL_UPDATE_2026_11_19,
    lastRevised: LEGAL_UPDATE_2026_11_19, publishedOn: LEGAL_UPDATE_2026_11_19, defaultStatus: "published_pending", risk: "medium",
    acceptance: "Ad-measurement (Meta pixel) choice is recorded in the visitor's browser only.",
    history: [{ version: "November 19, 2026", summary: "First published.", publishedOn: LEGAL_UPDATE_2026_11_19, supersededOn: null }],
  },
  {
    key: "subprocessors", name: "Service Providers (Subprocessors)", category: "core", href: "/subprocessors", public: true,
    version: "November 21, 2026", effectiveDate: null, originalPublication: LEGAL_UPDATE_2026_11_21,
    lastRevised: LEGAL_UPDATE_2026_11_21, publishedOn: LEGAL_UPDATE_2026_11_21, defaultStatus: "published_pending", risk: "low",
    acceptance: "Informational; referenced by the Privacy Policy and the Data Processing Addendum.",
    history: [{ version: "November 21, 2026", summary: "First published.", publishedOn: LEGAL_UPDATE_2026_11_21, supersededOn: null }],
  },
  {
    key: "accessibility", name: "Accessibility Statement", category: "core", href: "/accessibility", public: true,
    version: "November 21, 2026", effectiveDate: null, originalPublication: LEGAL_UPDATE_2026_11_21,
    lastRevised: LEGAL_UPDATE_2026_11_21, publishedOn: LEGAL_UPDATE_2026_11_21, defaultStatus: "published_pending", risk: "low",
    acceptance: "Informational.",
    history: [{ version: "November 21, 2026", summary: "First published.", publishedOn: LEGAL_UPDATE_2026_11_21, supersededOn: null }],
  },
  {
    key: "referral-terms", name: "Referral Program Terms", category: "program", href: "/referral-terms", public: true,
    version: "November 19, 2026", effectiveDate: null, originalPublication: LEGAL_UPDATE_2026_11_19,
    lastRevised: LEGAL_UPDATE_2026_11_19, publishedOn: LEGAL_UPDATE_2026_11_19, defaultStatus: "published_pending", risk: "medium",
    acceptance: "Linked from the referral card; no separate acceptance.",
    history: [{ version: "November 19, 2026", summary: "First published.", publishedOn: LEGAL_UPDATE_2026_11_19, supersededOn: null }],
  },
  {
    key: "trial-terms", name: "Free Trial, Pass and Gift Terms", category: "program", href: "/trial-terms", public: true,
    version: "November 19, 2026", effectiveDate: null, originalPublication: LEGAL_UPDATE_2026_11_19,
    lastRevised: LEGAL_UPDATE_2026_11_19, publishedOn: LEGAL_UPDATE_2026_11_19, defaultStatus: "published_pending", risk: "medium",
    acceptance: "No separate acceptance.",
    history: [{ version: "November 19, 2026", summary: "First published.", publishedOn: LEGAL_UPDATE_2026_11_19, supersededOn: null }],
  },
  {
    key: "academy-terms", name: "Academy Terms and Community Rules", category: "program", href: "/academy-terms", public: true,
    version: "November 19, 2026", effectiveDate: null, originalPublication: LEGAL_UPDATE_2026_11_19,
    lastRevised: LEGAL_UPDATE_2026_11_19, publishedOn: LEGAL_UPDATE_2026_11_19, defaultStatus: "published_pending", risk: "medium",
    acceptance: "Required checkbox when joining the Academy community.",
    history: [{ version: "November 19, 2026", summary: "First published.", publishedOn: LEGAL_UPDATE_2026_11_19, supersededOn: null }],
  },
  {
    key: "esign-disclosure", name: "Electronic Signature Disclosure", category: "disclosure", href: "/esign-disclosure", public: true,
    version: "November 21, 2026", effectiveDate: null, originalPublication: LEGAL_UPDATE_2026_11_19,
    lastRevised: "2026-11-21", publishedOn: "2026-11-21", defaultStatus: "published_pending", risk: "high",
    acceptance: "Signers consent on the signing page; consent and acceptance text are stored with each signature. Contractor signers affirm adoption, authorization and countersignature statements, each stored with its version.",
    history: [
      { version: "November 21, 2026", summary: "Added agreement to do business electronically, electronic delivery of copies and notices, an express intent-to-sign statement, and a section for contractors who sign for their company (adoption, automatic application, countersignature, security duties).", publishedOn: "2026-11-21", supersededOn: null },
      { version: "November 19, 2026", summary: "First published.", publishedOn: LEGAL_UPDATE_2026_11_19, supersededOn: "2026-11-21" },
    ],
  },
  {
    key: "security", name: "Security Overview", category: "disclosure", href: "/security", public: true,
    version: "November 18, 2026", effectiveDate: null, originalPublication: "2026-11-18",
    lastRevised: "2026-11-18", publishedOn: "2026-11-18", defaultStatus: "published_pending", risk: "low",
    acceptance: "Informational; no acceptance.",
    history: [{ version: "November 18, 2026", summary: "Current version.", publishedOn: "2026-11-18", supersededOn: null }],
  },
  {
    key: "signin-agreement", name: "Sign-up and Sign-in Agreement Statement", category: "in_product", href: "/login", public: true,
    location: "Sign-in and sign-up dialog", version: "Unversioned", effectiveDate: null, originalPublication: null,
    lastRevised: null, publishedOn: null, defaultStatus: "published_pending", risk: "high",
    acceptance: "\"By continuing you agree to the Terms and Privacy Policy\" (browsewrap-style); acceptance is not recorded per user.",
    history: [{ version: "Unversioned", summary: "Current statement.", publishedOn: null, supersededOn: null }],
  },
  {
    key: "customer-email-terms", name: "Customer Email Terms", category: "in_product", href: "/dashboard/customers/communications", public: false,
    location: "Customers → Communications (before the first customer email)", version: "1", effectiveDate: null, originalPublication: null,
    lastRevised: null, publishedOn: null, defaultStatus: "published_pending", risk: "medium",
    acceptance: "Checkbox + Accept; time, user and version 1 are recorded per company (comm_settings).",
    history: [{ version: "1", summary: "Current version.", publishedOn: null, supersededOn: null }],
  },
  {
    key: "sales-comp-program", name: "Sales Representative Compensation Program (How you get paid)", category: "in_product", href: "/sales/how-you-get-paid", public: false,
    location: "Sales Portal → How you get paid (reps only)", version: "Policy version recorded per award", effectiveDate: null, originalPublication: null,
    lastRevised: "2026-11-20", publishedOn: null, defaultStatus: "published_pending", risk: "high",
    acceptance: "No separate acceptance; a written sales agreement is referenced but not yet signed by any rep (no reps active).",
    history: [{ version: "V3 milestones", summary: "Commission, 30-day hold, anniversaries and milestone bonuses (randomized bonus off).", publishedOn: "2026-11-20", supersededOn: null }],
  },
  {
    key: "creator-program-terms", name: "Creator Partner Program Terms", category: "in_product", href: "/learning", public: false,
    location: "Creator workspace → Learning (before inviting anyone)", version: "creator-pilot-v1", effectiveDate: null, originalPublication: null,
    lastRevised: null, publishedOn: null, defaultStatus: "published_pending", risk: "medium",
    acceptance: "Required checkbox; confirmation time and terms version are recorded per program.",
    history: [{ version: "creator-pilot-v1", summary: "Current version.", publishedOn: null, supersededOn: null }],
  },
];

export const LEGAL_DOCUMENT_KEYS = LEGAL_DOCUMENTS.map((d) => d.key);
export const legalDocument = (key: string) => LEGAL_DOCUMENTS.find((d) => d.key === key);

export interface LegalStatusRecord { status: LegalStatus; reviewCompletedOn: string | null }

/** Effective status: the owner's recorded status when there is one, else the registry default. */
export function effectiveStatus(doc: LegalDocument, recorded?: Partial<LegalStatusRecord> | null): LegalStatusRecord {
  const s = recorded?.status;
  if (s && (LEGAL_STATUSES as readonly string[]).includes(s)) return { status: s, reviewCompletedOn: s === "reviewed" ? recorded?.reviewCompletedOn ?? null : null };
  return { status: doc.defaultStatus, reviewCompletedOn: null };
}

/** True while customers should see the "review pending" wording for this status. */
export const isPendingPublic = (s: LegalStatus) => s === "published_pending" || s === "revision_required";

export function statusCounts(statuses: LegalStatus[]): Record<LegalStatus, number> {
  const out = Object.fromEntries(LEGAL_STATUSES.map((s) => [s, 0])) as Record<LegalStatus, number>;
  for (const s of statuses) out[s] += 1;
  return out;
}

/** "2026-11-19" → "November 19, 2026" (UTC, no timezone drift). */
export function legalDate(iso: string | null): string {
  if (!iso) return "Not recorded";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
