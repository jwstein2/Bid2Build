/**
 * Start Your Contracting Business guide: shapes of the checked state files in ./data (written by
 * scripts/academy/startup/check_startup_evidence.py, never by hand).
 */

export const CREDENTIAL_KEYS = ["residential_building", "commercial_building", "electrical", "plumbing", "mechanical", "roofing", "pesticide", "asbestos", "lead_rrp"] as const;
export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

export const GENERAL_KEYS = ["entity", "state_tax", "unemployment", "workers_comp", "local"] as const;
export type GeneralKey = (typeof GENERAL_KEYS)[number];

export type CredentialStatus = "state_license" | "state_registration" | "threshold" | "no_state_license" | "local_only" | "unknown";
export type CheckStatus = "verified" | "pending_review";

export interface GeneralFact {
  agency: string | null;
  summary: string | null;
  url: string | null;
  quote: string | null;
  pending_reason: string | null;
  status_check: CheckStatus;
}

export interface Credential {
  status: CredentialStatus;
  name?: string | null;
  agency?: string | null;
  covers?: string | null;
  threshold?: string | null;
  prerequisites?: string[];
  bond?: string | null;
  insurance?: string | null;
  summary: string | null;
  url?: string | null;
  quote?: string | null;
  note?: string | null;
  evidence?: { url: string; quote: string }[];
  pending_reason: string | null;
  status_check: CheckStatus;
}

export interface OtherCredential {
  key: string;
  name: string | null;
  agency: string | null;
  trades: string[];
  summary: string | null;
  url: string | null;
  quote: string | null;
  pending_reason: string | null;
  status_check: CheckStatus;
}

export interface StateFile {
  state: string;
  researched_on: string | null;
  checked_at: string;
  general: Partial<Record<GeneralKey, GeneralFact>>;
  credentials: Record<CredentialKey, Credential>;
  other: OtherCredential[];
}

export interface FederalFact {
  key: string;
  name: string | null;
  agency: string | null;
  trades: string[];
  when: string | null;
  summary: string | null;
  url: string | null;
  link: string | null;
  quote: string | null;
  pending_reason: string | null;
  status_check: CheckStatus;
}

export interface FederalFile { checked_at: string; facts: FederalFact[] }
