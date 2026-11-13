import { D, type Dec } from "../estimate/money";

/**
 * Pure measurement formulas. Every input is a non-negative Decimal in the stated unit; validation
 * happens before these are called (see registry.ts). Nothing here rounds: rounding is a separate,
 * visible step so the contractor can see the exact value too.
 */
export const PI = D.acos(-1);
const TWELVE = new D(12);

/** Square feet of a rectangle. */
export const rectArea = (lengthFt: Dec, widthFt: Dec): Dec => lengthFt.times(widthFt);
/** Square feet of a triangle (gable ends, hip faces). */
export const triangleArea = (baseFt: Dec, heightFt: Dec): Dec => baseFt.times(heightFt).div(2);
/** Square feet of a circle from its diameter. */
export const circleArea = (diameterFt: Dec): Dec => PI.times(diameterFt.pow(2)).div(4);
/** Linear feet around a rectangle. */
export const rectPerimeter = (lengthFt: Dec, widthFt: Dec): Dec => lengthFt.plus(widthFt).times(2);

/** Add a waste / overage allowance given as a percentage ("10" = 10%). */
export const withWaste = (value: Dec, pct: Dec): Dec => value.times(new D(1).plus(pct.div(100)));

/**
 * Roof pitch factor: sloped length per unit of horizontal run for a pitch of `rise` inches per 12.
 * 6/12 → 1.1180, 12/12 → 1.4142. Flat (0/12) → 1.
 */
export const pitchFactor = (risePer12: Dec): Dec => new D(1).plus(risePer12.div(TWELVE).pow(2)).sqrt();

/** Cubic feet → cubic yards. */
export const cubicYards = (cubicFeet: Dec): Dec => cubicFeet.div(27);
/** Cubic feet of a slab from plan dimensions in feet and thickness in inches. */
export const slabCubicFeet = (lengthFt: Dec, widthFt: Dec, thicknessIn: Dec): Dec => lengthFt.times(widthFt).times(thicknessIn.div(TWELVE));
/** Cubic feet of a continuous footing: length in feet, width and depth in inches. */
export const footingCubicFeet = (lengthFt: Dec, widthIn: Dec, depthIn: Dec): Dec => lengthFt.times(widthIn.div(TWELVE)).times(depthIn.div(TWELVE));
/** Cubic feet of a round pier: diameter in inches, depth in feet. */
export const pierCubicFeet = (diameterIn: Dec, depthFt: Dec): Dec => circleArea(diameterIn.div(TWELVE)).times(depthFt);

export interface StairInput {
  /** Total rise from landing surface to top surface, inches. Optional if treadCount is given. */
  totalRiseIn?: Dec;
  /** Known number of treads. Takes precedence over the rise-based estimate. */
  treadCount?: Dec;
  treadDepthIn: Dec;
  widthFt: Dec;
  runs: Dec;
  maxRiserIn: Dec;
  stringerSpacingIn?: Dec;
}

export interface StairResult {
  risers: number;
  treads: number;
  riserHeightIn: Dec | null;
  totalRunIn: Dec;
  treadAreaSf: Dec;
  riserAreaSf: Dec;
  stringers: number;
}

/**
 * Stair layout estimate. Risers = ceil(total rise ÷ max riser) so no riser exceeds the maximum;
 * treads = risers − 1 (the top landing is the deck or floor). All counts are per run × runs.
 */
export function stairs(i: StairInput): StairResult {
  let risers: number;
  let treads: number;
  if (i.treadCount && i.treadCount.gt(0)) {
    treads = i.treadCount.toNumber();
    risers = treads + 1;
  } else if (i.totalRiseIn && i.totalRiseIn.gt(0) && i.maxRiserIn.gt(0)) {
    risers = i.totalRiseIn.div(i.maxRiserIn).ceil().toNumber();
    treads = Math.max(risers - 1, 0);
  } else {
    risers = 0;
    treads = 0;
  }
  const riserHeightIn = i.totalRiseIn && i.totalRiseIn.gt(0) && risers > 0 ? i.totalRiseIn.div(risers) : null;
  const runs = i.runs.toNumber();
  const treadAreaSf = i.widthFt.times(i.treadDepthIn.div(TWELVE)).times(treads).times(runs);
  const riserAreaSf = riserHeightIn ? i.widthFt.times(riserHeightIn.div(TWELVE)).times(risers).times(runs) : new D(0);
  const spacing = i.stringerSpacingIn && i.stringerSpacingIn.gt(0) ? i.stringerSpacingIn : new D(16);
  const perRun = i.widthFt.gt(0) ? i.widthFt.times(TWELVE).div(spacing).floor().toNumber() + 1 : 0;
  return { risers: risers * runs, treads: treads * runs, riserHeightIn, totalRunIn: i.treadDepthIn.times(treads), treadAreaSf, riserAreaSf, stringers: perRun * runs };
}

/** Packages (gallons, boxes, bundles…) needed to cover an area: area × coats × (1 + waste) ÷ coverage per package. */
export const coverageUnits = (areaSf: Dec, coats: Dec, coveragePerUnit: Dec, wastePct: Dec): Dec =>
  withWaste(areaSf.times(coats), wastePct).div(coveragePerUnit);

/** Linear feet of deck board needed to cover an area: area × 12 ÷ (face width + gap). */
export const deckingLinearFeet = (areaSf: Dec, faceWidthIn: Dec, gapIn: Dec): Dec => areaSf.times(TWELVE).div(faceWidthIn.plus(gapIn));

/** Labor hours: (quantity ÷ production rate per crew-hour) × crew size + fixed setup hours. */
export const laborHours = (quantity: Dec, ratePerCrewHour: Dec, crewSize: Dec, setupHours: Dec): Dec =>
  quantity.div(ratePerCrewHour).times(crewSize).plus(setupHours);

/** Unit conversion factors to a base unit per dimension (SF, LF, CF). */
export const CONVERSIONS: Record<string, { dim: "area" | "length" | "volume"; toBase: Dec; label: string }> = {
  "square foot": { dim: "area", toBase: new D(1), label: "square feet (SF)" },
  "square yard": { dim: "area", toBase: new D(9), label: "square yards (SY)" },
  square: { dim: "area", toBase: new D(100), label: "roofing/siding squares" },
  "square meter": { dim: "area", toBase: new D("10.76391041671"), label: "square meters (m²)" },
  "linear foot": { dim: "length", toBase: new D(1), label: "linear feet (LF)" },
  inch: { dim: "length", toBase: new D(1).div(12), label: "inches" },
  yard: { dim: "length", toBase: new D(3), label: "yards" },
  meter: { dim: "length", toBase: new D("3.280839895013"), label: "meters" },
  "cubic foot": { dim: "volume", toBase: new D(1), label: "cubic feet (CF)" },
  "cubic yard": { dim: "volume", toBase: new D(27), label: "cubic yards (CY)" },
  "cubic meter": { dim: "volume", toBase: new D("35.31466672149"), label: "cubic meters (m³)" },
};

/** Convert between two units of the same dimension; null when the dimensions differ. */
export function convertUnits(value: Dec, from: string, to: string): Dec | null {
  const a = CONVERSIONS[from];
  const b = CONVERSIONS[to];
  if (!a || !b || a.dim !== b.dim) return null;
  return value.times(a.toBase).div(b.toBase);
}

/** Units bought or counted in whole packages: results are rounded UP to a whole number. */
export const WHOLE_UNITS = new Set(["each", "piece", "box", "bundle", "roll", "sheet", "bag", "gallon"]);

/**
 * Round a calculated quantity for the estimate. Whole units round up to the next whole number
 * (you can't buy 3.2 boxes); everything else rounds up to 2 decimals so a quantity is never short.
 */
export function roundQuantity(value: Dec, unit: string): { value: Dec; note: string } {
  if (WHOLE_UNITS.has(unit)) {
    const v = value.toDecimalPlaces(6, D.ROUND_HALF_UP).ceil();
    return { value: v, note: `Rounded up to whole ${unit === "each" ? "units" : plural(unit)}.` };
  }
  return { value: value.toDecimalPlaces(6, D.ROUND_HALF_UP).toDecimalPlaces(2, D.ROUND_UP), note: "Rounded up to 2 decimal places." };
}

function plural(unit: string): string {
  if (unit === "box") return "boxes";
  if (unit === "piece") return "pieces";
  return `${unit}s`;
}
