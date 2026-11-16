/**
 * "What's slowing down your bids?" questionnaire (/bid-check): shared types.
 *
 * Everything in src/lib/bid-check is pure (no React, no Next, no database) so the branching, the
 * sample estimates and the result can be unit tested and rendered on the server or in the browser.
 */
export type Goal = "speed" | "profit" | "proposals" | "followup";
export const GOALS: readonly Goal[] = ["speed", "profit", "proposals", "followup"];

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export interface Question {
  /** Answer key. Trade-specific questions are prefixed with their trade ("decks.job"). */
  id: string;
  phase: "main" | "deep";
  prompt: string;
  help?: string;
  kind: "single" | "text";
  options: Option[];
  /** Text questions: skippable. */
  optional?: boolean;
  placeholder?: string;
  /** Trade this question belongs to; its answer is cleared when the contractor switches trade. */
  scope?: string;
}

export type Answers = Record<string, string>;

/** Where the visitor came from (URL parameters; never personal data). */
export interface Arrival {
  /** Campaign id (utm_campaign or c=). */
  campaign: string | null;
  /** fb_page | fb_messenger | fb_group | other referrer bucket. */
  source: string | null;
  /** Variant / post id (utm_content). */
  content: string | null;
  /** Trade preselected from the link (a key the trade question offers). */
  tradeHint: string | null;
}

/** A line in a sample estimate: [name, unit, costType, quantity, unitCost]. Example prices only. */
export type SampleLine = [string, string, string, number, number];

export interface SampleArea {
  /** Section name on the estimate. */
  group: string;
  /** The area broken out into separate labor and material lines (used when it's the pain point). */
  detail: SampleLine[];
  /** The same area as one or two package lines (every other area). */
  pkg: SampleLine[];
}
