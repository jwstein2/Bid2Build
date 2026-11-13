/**
 * Shared types for the optional quantity calculators.
 *
 * A calculator turns measurements into a quantity for ONE existing line item. It never creates
 * line items, never touches prices, and only changes the item's quantity when the contractor
 * presses Apply (and confirms replacing a different, manually entered quantity).
 */
export type CalcId =
  | "area"
  | "roof"
  | "linear"
  | "perimeter"
  | "volume"
  | "stairs"
  | "coverage"
  | "boards"
  | "convert"
  | "labor";

export type FieldKind = "feet" | "inches" | "number" | "integer" | "percent" | "pitch" | "select" | "checkbox";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** Short unit shown beside the input ("ft", "in", "SF per gallon"). */
  unit?: string;
  optional?: boolean;
  /** Pre-filled value for a new calculator. Never a price. */
  initial?: string;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  max?: number;
}

export interface ShapeDef {
  id: string;
  label: string;
  fields: FieldDef[];
}

/** One measured piece: a wall, a slab, a roof plane, an opening to subtract. */
export interface CalcSection {
  id: string;
  shape: string;
  /** Subtract this section (windows, doors, gates) instead of adding it. */
  deduct?: boolean;
  label?: string;
  values: Record<string, string>;
}

export interface CalcInput {
  sections: CalcSection[];
  options: Record<string, string>;
}

export interface OutputDef {
  id: string;
  /** Estimate unit this output produces (matches the line item's unit). */
  unit: string;
  label: string;
}

export interface CalcLine {
  label: string;
  detail: string;
  value: string;
  deduct?: boolean;
}

export interface CalcIssue {
  message: string;
  sectionId?: string;
  field?: string;
}

export interface CalcResult {
  ok: boolean;
  /** Rounded quantity ready to apply (decimal string), or null when there are errors. */
  quantity: string | null;
  /** Unrounded value, for transparency. */
  exact: string | null;
  unit: string;
  formula: string;
  /** How the quantity was reached, step by step. */
  lines: CalcLine[];
  /** How the result was rounded ("Rounded up to whole boxes"). */
  rounding?: string;
  errors: CalcIssue[];
  warnings: string[];
}

export interface CalcDef {
  id: CalcId;
  name: string;
  /** One sentence shown under the title. */
  summary: string;
  /** Section shapes; empty for calculators driven only by options (stairs, conversion, labor). */
  shapes: ShapeDef[];
  /** Whether sections can be marked as deductions. */
  deductions: boolean;
  options: FieldDef[];
  outputs: OutputDef[];
  compute(input: CalcInput, outputId: string): CalcResult;
}

/** Saved with the estimate when the contractor applies a calculation. */
export interface CalcRecord {
  v: 1;
  calc: CalcId;
  output: string;
  input: CalcInput;
  /** Quantity that was applied to the line item. */
  result: string;
  unit: string;
  appliedAt: string;
  /** Quantity and unit the line item had before this calculation was applied (for one-step restore). */
  previous?: { quantity: string; unit: string };
}

/** Estimate-level working data that never appears on the proposal. */
export interface EstimateWorksheet {
  /** Applied calculations, keyed by line item id. */
  calcs?: Record<string, CalcRecord>;
  /** Contractor-defined minimum job charge (decimal string). Used by the washing trades. */
  minimumCharge?: string;
}

/** A calculator offered for a particular line item, with trade-aware defaults. */
export interface CalcPreset {
  calc: CalcId;
  /** Contextual title, e.g. "Siding wall area". */
  label?: string;
  /** Shape for the first section of a new calculation. */
  shape?: string;
  /** Extra sections to start with (e.g. walls + gable + opening for siding). */
  extraShapes?: { shape: string; deduct?: boolean }[];
  output?: string;
  options?: Record<string, string>;
}
