import { D, ZERO, type Dec } from "../estimate/money";
import {
  CONVERSIONS, circleArea, convertUnits, coverageUnits, cubicYards, deckingLinearFeet, footingCubicFeet, laborHours, pierCubicFeet,
  pitchFactor, rectArea, rectPerimeter, roundQuantity, slabCubicFeet, stairs, triangleArea, withWaste,
} from "./formulas";
import { fmt, parseMessage, parseNumber } from "./parse";
import type { CalcDef, CalcId, CalcInput, CalcIssue, CalcLine, CalcResult, CalcSection, FieldDef, ShapeDef } from "./types";

/* ------------------------------------------------------------------------------------------------
 * Limits. Anything above these is almost certainly a typo (a 1,000,000 ft wall), so it is
 * rejected rather than silently producing an absurd quantity.
 * ---------------------------------------------------------------------------------------------- */
export const MAX_FEET = 100_000;
export const MAX_INCHES = 12_000;
export const MAX_COUNT = 10_000;
export const MAX_RESULT = new D("1e9");
export const MAX_SECTIONS = 60;

const feet = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: "feet", unit: "ft", ...extra });
const inches = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: "inches", unit: "in", ...extra });
const count: FieldDef = { key: "count", label: "Quantity", kind: "integer", unit: "×", optional: true, initial: "1", help: "How many identical pieces" };
const waste: FieldDef = { key: "waste", label: "Waste / overage", kind: "percent", unit: "%", optional: true, initial: "0", help: "Added after deductions" };

/* --------------------------------------------- Shapes ------------------------------------------ */

export const SHAPES: Record<string, ShapeDef> = {
  rect: { id: "rect", label: "Rectangle", fields: [feet("length", "Length"), feet("width", "Width"), count] },
  triangle: { id: "triangle", label: "Triangle / gable", fields: [feet("base", "Base width"), feet("height", "Height (peak)"), count] },
  circle: { id: "circle", label: "Circle", fields: [feet("diameter", "Diameter"), count] },
  wall: { id: "wall", label: "Walls (length × height)", fields: [feet("length", "Wall length or perimeter"), feet("height", "Wall height"), count] },
  opening: { id: "opening", label: "Opening (W × H)", fields: [feet("width", "Width"), feet("height", "Height"), count] },
  known_area: { id: "known_area", label: "Known area", fields: [{ key: "area", label: "Area", kind: "number", unit: "SF", max: 1e8 }, count] },
  // Linear
  run: { id: "run", label: "Straight run", fields: [feet("length", "Length"), count] },
  rect_perimeter: { id: "rect_perimeter", label: "Rectangle perimeter", fields: [feet("length", "Length"), feet("width", "Width"), count] },
  opening_trim: { id: "opening_trim", label: "Around an opening (W × H)", fields: [feet("width", "Width"), feet("height", "Height"), { key: "sides", label: "Sides trimmed", kind: "select", initial: "4", options: [{ value: "4", label: "All 4 sides" }, { value: "3", label: "3 sides (no sill)" }] }, count] },
  // Roof
  plane: { id: "plane", label: "Roof plane", fields: [feet("length", "Length (along eave)"), feet("width", "Width (eave to ridge)"), { key: "pitch", label: "Pitch", kind: "pitch", unit: "/12", placeholder: "6", help: "Rise in inches per 12 in of run (0 for flat)" }, count] },
  hip_face: { id: "hip_face", label: "Triangular face (hip end)", fields: [feet("base", "Base (along eave)"), feet("height", "Height (eave to peak)"), { key: "pitch", label: "Pitch", kind: "pitch", unit: "/12", placeholder: "6" }, count] },
  // Volume
  slab: { id: "slab", label: "Slab / flatwork", fields: [feet("length", "Length"), feet("width", "Width"), inches("thickness", "Thickness", { placeholder: "4" }), count] },
  footing: { id: "footing", label: "Continuous footing", fields: [feet("length", "Length"), inches("width", "Width"), inches("depth", "Depth"), count] },
  pier: { id: "pier", label: "Round pier / post hole", fields: [inches("diameter", "Diameter"), feet("depth", "Depth"), count] },
  box: { id: "box", label: "Excavation / box", fields: [feet("length", "Length"), feet("width", "Width"), feet("depth", "Depth"), count] },
};

/* ------------------------------------------ Validation ----------------------------------------- */

interface Ctx { errors: CalcIssue[]; warnings: string[] }

function maxFor(f: FieldDef): number {
  if (f.max !== undefined) return f.max;
  switch (f.kind) {
    case "feet": return MAX_FEET;
    case "inches": return MAX_INCHES;
    case "integer": return MAX_COUNT;
    case "percent": return 100;
    case "pitch": return 36;
    default: return 1e9;
  }
}

/** Parse one numeric field; returns undefined for an empty optional field. Pushes errors. */
function readField(f: FieldDef, raw: string | undefined, ctx: Ctx, where: { sectionId?: string; prefix?: string } = {}): Dec | undefined {
  const label = where.prefix ? `${where.prefix}: ${f.label}` : f.label;
  if (raw === undefined || raw.trim() === "") {
    if (!f.optional) ctx.errors.push({ message: parseMessage("empty", label), sectionId: where.sectionId, field: f.key, empty: true });
    return undefined;
  }
  const max = maxFor(f);
  const p = parseNumber(raw, { feet: f.kind === "feet", max });
  if (!p.ok) {
    ctx.errors.push({ message: parseMessage(p.error, label, max), sectionId: where.sectionId, field: f.key });
    return undefined;
  }
  if (f.kind === "integer" && !p.value.isInteger()) {
    ctx.errors.push({ message: `${label} must be a whole number.`, sectionId: where.sectionId, field: f.key });
    return undefined;
  }
  return p.value;
}

function readSection(shape: ShapeDef, s: CalcSection, ctx: Ctx, n: number): Record<string, Dec> | null {
  const before = ctx.errors.length;
  const out: Record<string, Dec> = {};
  for (const f of shape.fields) {
    if (f.kind === "select" || f.kind === "checkbox") continue;
    const v = readField(f, s.values[f.key], ctx, { sectionId: s.id, prefix: sectionName(s, n) });
    if (v !== undefined) out[f.key] = v;
  }
  if (out.count === undefined) out.count = new D(1);
  return ctx.errors.length > before ? null : out;
}

export function sectionName(s: CalcSection, n: number): string {
  return s.label?.trim() || `${s.deduct ? "Deduction" : "Section"} ${n}`;
}

function readOptions(fields: FieldDef[], input: CalcInput, ctx: Ctx): Record<string, Dec | undefined> {
  const out: Record<string, Dec | undefined> = {};
  for (const f of fields) {
    if (f.kind === "select" || f.kind === "checkbox") continue;
    const raw = input.options[f.key] ?? (f.optional ? f.initial : undefined);
    out[f.key] = readField(f, raw, ctx);
  }
  return out;
}

/** Dimensions keep up to 4 decimals so 2.125 ft never displays as 2.13 ft. */
const dim = (d: Dec) => fmt(d, 4);
const timesCount = (d: string, c: Dec) => (c.eq(1) ? d : `${d} × ${fmt(c, 4)}`);

/**
 * Sum measured sections (adds minus deductions). Each shape's measure function returns the
 * value of ONE piece in the base unit and a human description of the arithmetic.
 */
function sumSections(
  def: { shapes: ShapeDef[]; deductions: boolean },
  input: CalcInput,
  ctx: Ctx,
  measure: (shape: string, v: Record<string, Dec>, s: CalcSection) => { value: Dec; detail: string },
  unitAbbr: string,
): { total: Dec; adds: Dec; deducts: Dec; lines: CalcLine[] } | null {
  const lines: CalcLine[] = [];
  let adds = ZERO;
  let deducts = ZERO;
  if (!input.sections.length) {
    ctx.errors.push({ message: "Add at least one measurement.", empty: true });
    return null;
  }
  if (input.sections.length > MAX_SECTIONS) {
    ctx.errors.push({ message: `Use ${MAX_SECTIONS} sections or fewer.` });
    return null;
  }
  input.sections.forEach((s, idx) => {
    const shape = def.shapes.find((x) => x.id === s.shape);
    if (!shape) { ctx.errors.push({ message: `Section ${idx + 1} has an unknown shape.`, sectionId: s.id }); return; }
    const v = readSection(shape, s, ctx, idx + 1);
    if (!v) return;
    const one = measure(shape.id, v, s);
    const value = one.value.times(v.count);
    const deduct = Boolean(def.deductions && s.deduct);
    if (value.isZero()) ctx.warnings.push(`${sectionName(s, idx + 1)} measures 0 ${unitAbbr}.`);
    if (deduct) deducts = deducts.plus(value); else adds = adds.plus(value);
    lines.push({ label: sectionName(s, idx + 1), detail: timesCount(one.detail, v.count), value: `${deduct ? "−" : ""}${fmt(value)} ${unitAbbr}`, deduct });
  });
  if (ctx.errors.length) return null;
  const total = adds.minus(deducts);
  if (total.isNegative()) {
    ctx.errors.push({ message: `Deductions (${fmt(deducts)} ${unitAbbr}) are larger than the measured total (${fmt(adds)} ${unitAbbr}).` });
    return null;
  }
  return { total, adds, deducts, lines };
}

function finish(ctx: Ctx, exact: Dec | null, unit: string, formula: string, lines: CalcLine[]): CalcResult {
  if (ctx.errors.length || !exact) return { ok: false, quantity: null, exact: null, unit, formula, lines, errors: ctx.errors, warnings: ctx.warnings };
  if (!exact.isFinite() || exact.gt(MAX_RESULT)) {
    return { ok: false, quantity: null, exact: null, unit, formula, lines, errors: [{ message: "The result is too large. Check the measurements and units." }], warnings: ctx.warnings };
  }
  const r = roundQuantity(exact, unit);
  return { ok: true, quantity: r.value.toFixed(), exact: exact.toFixed(), unit, formula, lines, rounding: r.note, errors: [], warnings: ctx.warnings };
}

function wasteLine(lines: CalcLine[], base: Dec, pct: Dec | undefined, abbr: string): Dec {
  if (!pct || pct.isZero()) return base;
  const v = withWaste(base, pct);
  lines.push({ label: `Waste / overage ${fmt(pct)}%`, detail: `${fmt(base)} × ${fmt(new D(1).plus(pct.div(100)), 4)}`, value: `${fmt(v)} ${abbr}` });
  return v;
}

const UNIT_ABBR: Record<string, string> = {
  "square foot": "SF", "square yard": "SY", square: "sq", "linear foot": "LF", "cubic yard": "CY", piece: "pcs", each: "ea",
  hour: "hr", day: "days", gallon: "gal", box: "boxes", bundle: "bundles", roll: "rolls", sheet: "sheets", bag: "bags",
};
export const abbr = (unit: string) => UNIT_ABBR[unit] ?? unit;

/* -------------------------------------------- Area --------------------------------------------- */

function areaMeasure(shape: string, v: Record<string, Dec>): { value: Dec; detail: string } {
  switch (shape) {
    case "rect": return { value: rectArea(v.length, v.width), detail: `${dim(v.length)} × ${dim(v.width)} ft` };
    case "wall": return { value: rectArea(v.length, v.height), detail: `${dim(v.length)} ft × ${dim(v.height)} ft high` };
    case "opening": return { value: rectArea(v.width, v.height), detail: `${dim(v.width)} × ${dim(v.height)} ft` };
    case "triangle": return { value: triangleArea(v.base, v.height), detail: `½ × ${dim(v.base)} × ${dim(v.height)} ft` };
    case "circle": return { value: circleArea(v.diameter), detail: `π × ${dim(v.diameter)}² ÷ 4` };
    default: return { value: v.area, detail: `${dim(v.area)} SF` };
  }
}

const AREA_OUTPUTS = [
  { id: "sf", unit: "square foot", label: "Square feet (SF)" },
  { id: "sy", unit: "square yard", label: "Square yards (SY)" },
  { id: "sq", unit: "square", label: "Squares (100 SF)" },
];
const AREA_DIVISOR: Record<string, number> = { sf: 1, sy: 9, sq: 100 };

function areaOutput(lines: CalcLine[], sf: Dec, outputId: string): { value: Dec; unit: string } {
  const out = AREA_OUTPUTS.find((o) => o.id === outputId) ?? AREA_OUTPUTS[0];
  const div = AREA_DIVISOR[out.id] ?? 1;
  if (div === 1) return { value: sf, unit: out.unit };
  const value = sf.div(div);
  lines.push({ label: `Convert to ${out.label.toLowerCase()}`, detail: `${fmt(sf)} SF ÷ ${div}`, value: `${fmt(value)} ${abbr(out.unit)}` });
  return { value, unit: out.unit };
}

const area: CalcDef = {
  id: "area",
  name: "Area",
  summary: "Add rectangles, triangles and walls; subtract openings; add waste.",
  shapes: [SHAPES.rect, SHAPES.wall, SHAPES.triangle, SHAPES.opening, SHAPES.circle, SHAPES.known_area],
  deductions: true,
  options: [waste],
  outputs: AREA_OUTPUTS,
  compute(input, outputId) {
    const ctx: Ctx = { errors: [], warnings: [] };
    const opts = readOptions(this.options, input, ctx);
    const sum = sumSections(this, input, ctx, areaMeasure, "SF");
    if (!sum) return finish(ctx, null, AREA_OUTPUTS[0].unit, "", []);
    const lines = [...sum.lines];
    if (sum.deducts.gt(0)) lines.push({ label: "Net area", detail: `${fmt(sum.adds)} − ${fmt(sum.deducts)} SF`, value: `${fmt(sum.total)} SF` });
    const sf = wasteLine(lines, sum.total, opts.waste, "SF");
    const out = areaOutput(lines, sf, outputId);
    return finish(ctx, out.value, out.unit, "Area = Σ sections − deductions, then × (1 + waste %)", lines);
  },
};

/* -------------------------------------------- Roof --------------------------------------------- */

const roof: CalcDef = {
  id: "roof",
  name: "Roof planes",
  summary: "Measure each plane, apply its pitch factor, and add waste.",
  shapes: [SHAPES.plane, SHAPES.hip_face, SHAPES.known_area],
  deductions: true,
  options: [
    { key: "measured", label: "Dimensions measured", kind: "select", initial: "plan", options: [
      { value: "plan", label: "Horizontally (plan or ground) – apply pitch" },
      { value: "surface", label: "On the roof surface – no pitch factor" },
    ] },
    waste,
  ],
  outputs: [{ id: "sq", unit: "square", label: "Squares (100 SF)" }, { id: "sf", unit: "square foot", label: "Square feet (SF)" }],
  compute(input, outputId) {
    const ctx: Ctx = { errors: [], warnings: [] };
    const opts = readOptions(this.options, input, ctx);
    const onSurface = (input.options.measured ?? "plan") === "surface";
    const sum = sumSections(this, input, ctx, (shape, v) => {
      if (shape === "known_area") return areaMeasure(shape, v);
      const base = shape === "plane" ? rectArea(v.length, v.width) : triangleArea(v.base, v.height);
      const dims = shape === "plane" ? `${dim(v.length)} × ${dim(v.width)} ft` : `½ × ${dim(v.base)} × ${dim(v.height)} ft`;
      if (onSurface) return { value: base, detail: dims };
      const pitch = v.pitch;
      if (pitch.gt(24)) ctx.warnings.push(`A ${fmt(pitch)}/12 pitch is unusually steep. Confirm the measurement.`);
      const f = pitchFactor(pitch);
      return { value: base.times(f), detail: `${dims} × ${fmt(f, 4)} (${fmt(pitch)}/12 pitch)` };
    }, "SF");
    if (!sum) return finish(ctx, null, "square", "", []);
    const lines = [...sum.lines];
    if (sum.deducts.gt(0)) lines.push({ label: "Net roof area", detail: `${fmt(sum.adds)} − ${fmt(sum.deducts)} SF`, value: `${fmt(sum.total)} SF` });
    const sf = wasteLine(lines, sum.total, opts.waste, "SF");
    let value = sf;
    let unit = "square foot";
    if (outputId !== "sf") {
      value = sf.div(100);
      unit = "square";
      lines.push({ label: "Convert to squares", detail: `${fmt(sf)} SF ÷ 100`, value: `${fmt(value)} sq` });
    }
    const formula = onSurface ? "Roof area = Σ planes − deductions, × (1 + waste %)" : "Roof area = Σ (plan area × √(1 + (pitch ÷ 12)²)) − deductions, × (1 + waste %)";
    return finish(ctx, value, unit, formula, lines);
  },
};

/* ------------------------------------------- Linear -------------------------------------------- */

function linearMeasure(shape: string, v: Record<string, Dec>, s: CalcSection): { value: Dec; detail: string } {
  switch (shape) {
    case "rect_perimeter": return { value: rectPerimeter(v.length, v.width), detail: `2 × (${dim(v.length)} + ${dim(v.width)}) ft` };
    case "opening_trim": {
      const three = s.values.sides === "3";
      return three
        ? { value: v.width.plus(v.height.times(2)), detail: `${dim(v.width)} + 2 × ${dim(v.height)} ft (3 sides)` }
        : { value: rectPerimeter(v.width, v.height), detail: `2 × (${dim(v.width)} + ${dim(v.height)}) ft` };
    }
    default: return { value: v.length, detail: `${dim(v.length)} ft` };
  }
}

const LINEAR_OUTPUTS = [
  { id: "lf", unit: "linear foot", label: "Linear feet (LF)" },
  { id: "pcs", unit: "piece", label: "Pieces (by piece length)" },
  { id: "each", unit: "each", label: "Boards / lengths (each)" },
];

function linearDef(id: "linear" | "perimeter", name: string, summary: string, shapes: ShapeDef[]): CalcDef {
  return {
    id,
    name,
    summary,
    shapes,
    deductions: true,
    options: [waste, feet("pieceLength", "Piece / board length", { optional: true, help: "Only needed to convert to pieces (e.g. 12.5 ft J-channel, 16 ft fascia)" })],
    outputs: LINEAR_OUTPUTS,
    compute(input, outputId) {
      const ctx: Ctx = { errors: [], warnings: [] };
      const opts = readOptions(this.options, input, ctx);
      const sum = sumSections(this, input, ctx, linearMeasure, "LF");
      if (!sum) return finish(ctx, null, "linear foot", "", []);
      const lines = [...sum.lines];
      if (sum.deducts.gt(0)) lines.push({ label: "Net length", detail: `${fmt(sum.adds)} − ${fmt(sum.deducts)} LF`, value: `${fmt(sum.total)} LF` });
      const lf = wasteLine(lines, sum.total, opts.waste, "LF");
      if (outputId === "pcs" || outputId === "each") {
        const unit = outputId === "each" ? "each" : "piece";
        const len = opts.pieceLength;
        if (!len || len.isZero()) {
          ctx.errors.push({ message: "Enter the piece length to convert linear feet to pieces.", field: "pieceLength" });
          return finish(ctx, null, unit, "", lines);
        }
        const pcs = lf.div(len);
        lines.push({ label: "Convert to pieces", detail: `${fmt(lf)} LF ÷ ${fmt(len)} ft`, value: `${fmt(pcs)} ${abbr(unit)}` });
        return finish(ctx, pcs, unit, "Pieces = (Σ lengths − deductions) × (1 + waste %) ÷ piece length", lines);
      }
      return finish(ctx, lf, "linear foot", "Length = Σ runs − deductions, then × (1 + waste %)", lines);
    },
  };
}

const linear = linearDef("linear", "Linear footage", "Add runs, trim around openings, subtract gates or doorways.", [SHAPES.run, SHAPES.opening_trim, SHAPES.rect_perimeter]);
const perimeter = linearDef("perimeter", "Perimeter", "Perimeter of rectangles or a list of sides, less any openings.", [SHAPES.rect_perimeter, SHAPES.run, SHAPES.opening_trim]);

/* ------------------------------------------- Volume -------------------------------------------- */

function volumeMeasure(shape: string, v: Record<string, Dec>): { value: Dec; detail: string } {
  switch (shape) {
    case "slab": return { value: slabCubicFeet(v.length, v.width, v.thickness), detail: `${dim(v.length)} × ${dim(v.width)} ft × ${dim(v.thickness)} in` };
    case "footing": return { value: footingCubicFeet(v.length, v.width, v.depth), detail: `${dim(v.length)} ft × ${dim(v.width)} in × ${dim(v.depth)} in` };
    case "pier": return { value: pierCubicFeet(v.diameter, v.depth), detail: `π × (${dim(v.diameter)} in)² ÷ 4 × ${dim(v.depth)} ft` };
    default: return { value: v.length.times(v.width).times(v.depth), detail: `${dim(v.length)} × ${dim(v.width)} × ${dim(v.depth)} ft` };
  }
}

const volume: CalcDef = {
  id: "volume",
  name: "Volume",
  summary: "Slabs, footings and piers to cubic yards, with a material allowance.",
  shapes: [SHAPES.slab, SHAPES.footing, SHAPES.pier, SHAPES.box],
  deductions: true,
  options: [{ ...waste, label: "Material allowance", help: "Overage for subgrade variation and spillage" }],
  outputs: [{ id: "cy", unit: "cubic yard", label: "Cubic yards (CY)" }],
  compute(input) {
    const ctx: Ctx = { errors: [], warnings: [] };
    const opts = readOptions(this.options, input, ctx);
    const sum = sumSections(this, input, ctx, volumeMeasure, "CF");
    if (!sum) return finish(ctx, null, "cubic yard", "", []);
    const lines = [...sum.lines];
    const cy = cubicYards(sum.total);
    lines.push({ label: "Convert to cubic yards", detail: `${fmt(sum.total)} CF ÷ 27`, value: `${fmt(cy)} CY` });
    const out = wasteLine(lines, cy, opts.waste, "CY");
    return finish(ctx, out, "cubic yard", "Volume = Σ (L × W × depth) ÷ 27, then × (1 + allowance %)", lines);
  },
};

/* ------------------------------------------- Stairs -------------------------------------------- */

const STAIR_OUTPUTS = [
  { id: "tread_area", unit: "square foot", label: "Tread area (SF)" },
  { id: "tread_riser_area", unit: "square foot", label: "Tread + riser area (SF)" },
  { id: "treads", unit: "each", label: "Number of treads" },
  { id: "risers", unit: "each", label: "Number of risers" },
  { id: "stringers", unit: "each", label: "Number of stringers" },
];

export const STAIR_CODE_NOTE = "Typical IRC residential limits. Your local code governs: confirm before building.";

const stairsDef: CalcDef = {
  id: "stairs",
  name: "Stairs",
  summary: "Riser and tread count from total rise, plus tread coverage and stringers.",
  shapes: [],
  deductions: false,
  options: [
    inches("totalRise", "Total rise", { optional: true, help: "Top of landing to top of deck or floor" }),
    { key: "treadCount", label: "Treads (if known)", kind: "integer", optional: true, help: "Leave blank to estimate from total rise" },
    inches("treadDepth", "Tread depth", { placeholder: "10.5", help: "Front to back, per tread" }),
    feet("width", "Stair width"),
    { key: "runs", label: "Stair runs", kind: "integer", optional: true, initial: "1" },
    inches("maxRiser", "Max riser height", { optional: true, initial: "7.75", help: "Your local code limit" }),
    inches("stringerSpacing", "Stringer spacing", { optional: true, initial: "16" }),
  ],
  outputs: STAIR_OUTPUTS,
  compute(input, outputId) {
    const ctx: Ctx = { errors: [], warnings: [] };
    const o = readOptions(this.options, input, ctx);
    const out = STAIR_OUTPUTS.find((x) => x.id === outputId) ?? STAIR_OUTPUTS[0];
    if (!ctx.errors.length && !o.totalRise?.gt(0) && !o.treadCount?.gt(0)) ctx.errors.push({ message: "Enter the total rise or the number of treads.", field: "totalRise", empty: true });
    if (o.maxRiser && o.maxRiser.isZero()) ctx.errors.push({ message: "Max riser height must be greater than 0.", field: "maxRiser" });
    if (o.runs && o.runs.isZero()) ctx.errors.push({ message: "Stair runs must be at least 1.", field: "runs" });
    if (ctx.errors.length) return finish(ctx, null, out.unit, "", []);
    const r = stairs({
      totalRiseIn: o.totalRise, treadCount: o.treadCount, treadDepthIn: o.treadDepth!, widthFt: o.width!, runs: o.runs ?? new D(1),
      maxRiserIn: o.maxRiser ?? new D("7.75"), stringerSpacingIn: o.stringerSpacing,
    });
    const runs = (o.runs ?? new D(1)).toNumber();
    const lines: CalcLine[] = [];
    if (o.treadCount?.gt(0)) lines.push({ label: "Treads", detail: `${fmt(o.treadCount)} per run (entered)`, value: `${r.treads}` });
    else lines.push({ label: "Risers", detail: `${fmt(o.totalRise!)} in ÷ ${fmt(o.maxRiser ?? new D("7.75"))} in max, rounded up${runs > 1 ? ` × ${runs} runs` : ""}`, value: `${r.risers}` });
    lines.push({ label: o.treadCount?.gt(0) ? "Risers" : "Treads", detail: o.treadCount?.gt(0) ? "treads + 1 per run" : "risers − 1 per run (top is the landing)", value: `${o.treadCount?.gt(0) ? r.risers : r.treads}` });
    if (r.riserHeightIn) lines.push({ label: "Actual riser height", detail: `${fmt(o.totalRise!)} in ÷ ${r.risers / runs} risers`, value: `${fmt(r.riserHeightIn, 3)} in` });
    lines.push({ label: "Total run", detail: `${r.treads / runs} treads × ${fmt(o.treadDepth!)} in`, value: `${fmt(r.totalRunIn)} in (${fmt(r.totalRunIn.div(12))} ft)` });
    lines.push({ label: "Tread area", detail: `${fmt(o.width!)} ft × ${fmt(o.treadDepth!)} in × ${r.treads} treads`, value: `${fmt(r.treadAreaSf)} SF` });
    if (r.riserHeightIn) lines.push({ label: "Riser area", detail: `${fmt(o.width!)} ft × ${fmt(r.riserHeightIn, 3)} in × ${r.risers} risers`, value: `${fmt(r.riserAreaSf)} SF` });
    lines.push({ label: "Stringers", detail: `${fmt(o.width!)} ft at ${fmt(o.stringerSpacing ?? new D(16))} in spacing, + 1${runs > 1 ? ` × ${runs} runs` : ""}`, value: `${r.stringers}` });

    // Code-related warnings. Never presented as compliance advice.
    const maxR = o.maxRiser ?? new D("7.75");
    if (r.riserHeightIn && r.riserHeightIn.gt(maxR)) ctx.warnings.push(`Riser height ${fmt(r.riserHeightIn, 3)} in is above your ${fmt(maxR)} in maximum. Add a tread or check the rise.`);
    if (r.riserHeightIn && r.riserHeightIn.lt(4)) ctx.warnings.push(`Riser height ${fmt(r.riserHeightIn, 3)} in is under 4 in, below the usual minimum.`);
    if (maxR.gt("7.75")) ctx.warnings.push("Max riser is set above 7¾ in, the usual IRC residential limit.");
    if (o.treadDepth!.lt(10)) ctx.warnings.push(`Tread depth ${fmt(o.treadDepth!)} in is under 10 in, the usual IRC minimum.`);
    if (o.width!.gt(0) && o.width!.lt(3)) ctx.warnings.push("Stair width is under 36 in, the usual IRC minimum.");
    if (o.totalRise && o.totalRise.gt(151)) ctx.warnings.push("Total rise is over 151 in (12 ft 7 in). A landing is usually required between flights.");
    if (ctx.warnings.length) ctx.warnings.push(STAIR_CODE_NOTE);

    let value: Dec;
    switch (out.id) {
      case "tread_riser_area": value = r.treadAreaSf.plus(r.riserAreaSf); break;
      case "treads": value = new D(r.treads); break;
      case "risers": value = new D(r.risers); break;
      case "stringers": value = new D(r.stringers); break;
      default: value = r.treadAreaSf;
    }
    if (value.isZero() && out.id !== "tread_area") ctx.warnings.push("The result is 0.");
    return finish(ctx, value, out.unit, "Risers = ⌈total rise ÷ max riser⌉; treads = risers − 1; tread area = width × depth × treads", lines);
  },
};

/* ------------------------------------------ Coverage ------------------------------------------- */

const PACKAGE_UNITS = ["gallon", "box", "bundle", "roll", "sheet", "bag", "piece", "each"];

const coverage: CalcDef = {
  id: "coverage",
  name: "Material coverage",
  summary: "Packages needed for an area: coats, coverage per package and waste.",
  shapes: [SHAPES.rect, SHAPES.wall, SHAPES.known_area, SHAPES.triangle, SHAPES.opening],
  deductions: true,
  options: [
    { key: "coveragePer", label: "Coverage per package", kind: "number", unit: "SF", help: "From the product label or your supplier", max: 1e6 },
    { key: "coats", label: "Coats / layers", kind: "integer", optional: true, initial: "1" },
    waste,
  ],
  outputs: PACKAGE_UNITS.map((u) => ({ id: u, unit: u, label: u === "each" ? "Units" : `${u[0].toUpperCase()}${u.slice(1)}s` })),
  compute(input, outputId) {
    const ctx: Ctx = { errors: [], warnings: [] };
    const unit = PACKAGE_UNITS.includes(outputId) ? outputId : "each";
    const o = readOptions(this.options, input, ctx);
    if (o.coveragePer && o.coveragePer.isZero()) ctx.errors.push({ message: "Coverage per package must be greater than 0.", field: "coveragePer" });
    if (o.coats && o.coats.isZero()) ctx.errors.push({ message: "Coats must be at least 1.", field: "coats" });
    const sum = sumSections(this, input, ctx, areaMeasure, "SF");
    if (!sum || ctx.errors.length) return finish(ctx, null, unit, "", sum?.lines ?? []);
    const lines = [...sum.lines];
    const coats = o.coats ?? new D(1);
    if (sum.deducts.gt(0)) lines.push({ label: "Net area", detail: `${fmt(sum.adds)} − ${fmt(sum.deducts)} SF`, value: `${fmt(sum.total)} SF` });
    if (!coats.eq(1)) lines.push({ label: "Coats", detail: `${fmt(sum.total)} SF × ${fmt(coats)} coats`, value: `${fmt(sum.total.times(coats))} SF` });
    const withW = wasteLine(lines, sum.total.times(coats), o.waste, "SF");
    const pk = coverageUnits(sum.total, coats, o.coveragePer!, o.waste ?? ZERO);
    lines.push({ label: "Packages", detail: `${fmt(withW)} SF ÷ ${fmt(o.coveragePer!)} SF each`, value: `${fmt(pk)} ${abbr(unit)}` });
    return finish(ctx, pk, unit, "Packages = area × coats × (1 + waste %) ÷ coverage per package", lines);
  },
};

/* ------------------------------------------- Boards -------------------------------------------- */

const boards: CalcDef = {
  id: "boards",
  name: "Decking boards",
  summary: "Boards or linear feet of decking to cover the deck area.",
  shapes: [SHAPES.rect, SHAPES.known_area, SHAPES.triangle, SHAPES.circle],
  deductions: true,
  options: [
    feet("boardLength", "Board length", { placeholder: "16" }),
    inches("faceWidth", "Board face width", { placeholder: "5.5", help: "Actual width, e.g. 5.5 in for a 5/4×6" }),
    inches("gap", "Gap between boards", { optional: true, placeholder: "0.1875", help: "Blank = no gap. 3/16 in = 0.1875" }),
    waste,
  ],
  outputs: [{ id: "boards", unit: "each", label: "Boards" }, { id: "boards_pcs", unit: "piece", label: "Boards (pieces)" }, { id: "lf", unit: "linear foot", label: "Linear feet of board" }],
  compute(input, outputId) {
    const ctx: Ctx = { errors: [], warnings: [] };
    const o = readOptions(this.options, input, ctx);
    const unit = outputId === "lf" ? "linear foot" : outputId === "boards_pcs" ? "piece" : "each";
    if (o.boardLength && o.boardLength.isZero()) ctx.errors.push({ message: "Board length must be greater than 0.", field: "boardLength" });
    if (o.faceWidth && o.faceWidth.isZero()) ctx.errors.push({ message: "Board face width must be greater than 0.", field: "faceWidth" });
    const sum = sumSections(this, input, ctx, areaMeasure, "SF");
    if (!sum || ctx.errors.length) return finish(ctx, null, unit, "", sum?.lines ?? []);
    const lines = [...sum.lines];
    if (sum.deducts.gt(0)) lines.push({ label: "Net deck area", detail: `${fmt(sum.adds)} − ${fmt(sum.deducts)} SF`, value: `${fmt(sum.total)} SF` });
    const gap = o.gap ?? ZERO;
    const lf = deckingLinearFeet(sum.total, o.faceWidth!, gap);
    lines.push({ label: "Board footage", detail: `${fmt(sum.total)} SF × 12 ÷ (${fmt(o.faceWidth!, 4)} + ${fmt(gap, 4)}) in`, value: `${fmt(lf)} LF` });
    const lfW = wasteLine(lines, lf, o.waste, "LF");
    if (unit === "linear foot") return finish(ctx, lfW, unit, "Board LF = area × 12 ÷ (face width + gap) × (1 + waste %)", lines);
    const n = lfW.div(o.boardLength!);
    lines.push({ label: "Boards", detail: `${fmt(lfW)} LF ÷ ${fmt(o.boardLength!)} ft boards`, value: `${fmt(n)}` });
    return finish(ctx, n, unit, "Boards = area × 12 ÷ (face width + gap) × (1 + waste %) ÷ board length", lines);
  },
};

/* ----------------------------------------- Conversion ------------------------------------------ */

const CONVERT_TARGETS = ["square foot", "square yard", "square", "linear foot", "cubic yard"];

const convert: CalcDef = {
  id: "convert",
  name: "Unit conversion",
  summary: "Convert a measurement you already have into this line item's unit.",
  shapes: [],
  deductions: false,
  options: [
    { key: "value", label: "Amount", kind: "number", max: 1e9 },
    { key: "from", label: "From", kind: "select", initial: "square foot", options: Object.entries(CONVERSIONS).map(([value, c]) => ({ value, label: c.label })) },
  ],
  outputs: CONVERT_TARGETS.map((u) => ({ id: u, unit: u, label: CONVERSIONS[u].label })),
  compute(input, outputId) {
    const ctx: Ctx = { errors: [], warnings: [] };
    const to = CONVERT_TARGETS.includes(outputId) ? outputId : "square foot";
    const o = readOptions(this.options, input, ctx);
    const from = input.options.from ?? "square foot";
    if (ctx.errors.length) return finish(ctx, null, to, "", []);
    const v = convertUnits(o.value!, from, to);
    if (!v) {
      ctx.errors.push({ message: `Can't convert ${CONVERSIONS[from]?.label ?? from} to ${CONVERSIONS[to].label}: they measure different things.`, field: "from" });
      return finish(ctx, null, to, "", []);
    }
    const a = CONVERSIONS[from];
    const b = CONVERSIONS[to];
    const lines: CalcLine[] = [{ label: "Conversion", detail: `${fmt(o.value!, 4)} ${a.label} × ${fmt(a.toBase, 6)} ÷ ${fmt(b.toBase, 6)}`, value: `${fmt(v)} ${abbr(to)}` }];
    return finish(ctx, v, to, `1 ${from} = ${fmt(a.toBase.div(b.toBase), 6)} ${to}`, lines);
  },
};

/* ------------------------------------------- Labor --------------------------------------------- */

const labor: CalcDef = {
  id: "labor",
  name: "Labor hours",
  summary: "Hours from your own production rate and crew size.",
  shapes: [],
  deductions: false,
  options: [
    { key: "quantity", label: "Work quantity", kind: "number", help: "e.g. 1,200 SF of surface", max: 1e8 },
    { key: "rate", label: "Production rate per crew-hour", kind: "number", help: "Your crew's typical output, in the same unit", max: 1e7 },
    { key: "crew", label: "Crew size", kind: "integer", optional: true, initial: "1", unit: "people" },
    { key: "setup", label: "Setup, travel and cleanup", kind: "number", optional: true, initial: "0", unit: "hr", max: 10_000 },
    { key: "hoursPerDay", label: "Hours per day", kind: "number", optional: true, initial: "8", unit: "hr", max: 24 },
  ],
  outputs: [{ id: "hour", unit: "hour", label: "Labor hours" }, { id: "day", unit: "day", label: "Crew days" }],
  compute(input, outputId) {
    const ctx: Ctx = { errors: [], warnings: [] };
    const o = readOptions(this.options, input, ctx);
    const unit = outputId === "day" ? "day" : "hour";
    if (o.rate && o.rate.isZero()) ctx.errors.push({ message: "Production rate must be greater than 0.", field: "rate" });
    if (o.crew && o.crew.isZero()) ctx.errors.push({ message: "Crew size must be at least 1.", field: "crew" });
    if (o.hoursPerDay && o.hoursPerDay.isZero()) ctx.errors.push({ message: "Hours per day must be greater than 0.", field: "hoursPerDay" });
    if (ctx.errors.length) return finish(ctx, null, unit, "", []);
    const crew = o.crew ?? new D(1);
    const setup = o.setup ?? ZERO;
    const crewHours = o.quantity!.div(o.rate!);
    const hours = laborHours(o.quantity!, o.rate!, crew, setup);
    const lines: CalcLine[] = [
      { label: "Crew-hours", detail: `${fmt(o.quantity!)} ÷ ${fmt(o.rate!)} per hour`, value: `${fmt(crewHours)} hr` },
      { label: "Labor hours", detail: `${fmt(crewHours)} × ${fmt(crew)} people${setup.gt(0) ? ` + ${fmt(setup)} hr setup` : ""}`, value: `${fmt(hours)} hr` },
    ];
    if (unit === "day") {
      const hpd = o.hoursPerDay ?? new D(8);
      const days = crewHours.plus(setup.div(crew)).div(hpd);
      lines.push({ label: "Crew days", detail: `(${fmt(crewHours)} + ${fmt(setup.div(crew))} setup) crew-hours ÷ ${fmt(hpd)} hr per day`, value: `${fmt(days)} days` });
      return finish(ctx, days, unit, "Crew days = (quantity ÷ rate + setup ÷ crew) ÷ hours per day", lines);
    }
    return finish(ctx, hours, unit, "Labor hours = quantity ÷ production rate × crew size + setup hours", lines);
  },
};

/* ------------------------------------------ Registry ------------------------------------------- */

export const CALCULATORS: Record<CalcId, CalcDef> = {
  area, roof, linear, perimeter, volume, stairs: stairsDef, coverage, boards, convert, labor,
};

export const getCalculator = (id: CalcId): CalcDef => CALCULATORS[id];

/** Run a calculator safely: unexpected exceptions become a visible error instead of a crash. */
export function runCalculator(id: CalcId, input: CalcInput, outputId: string): CalcResult {
  const def = CALCULATORS[id];
  try {
    return def.compute(input, outputId);
  } catch {
    return { ok: false, quantity: null, exact: null, unit: def.outputs[0]?.unit ?? "each", formula: "", lines: [], errors: [{ message: "Those measurements could not be calculated. Check the values." }], warnings: [] };
  }
}
