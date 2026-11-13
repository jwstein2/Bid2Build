import { describe, expect, it } from "vitest";
import { D } from "@/lib/estimate/money";
import {
  circleArea, convertUnits, coverageUnits, cubicYards, deckingLinearFeet, footingCubicFeet, laborHours, pierCubicFeet, pitchFactor,
  rectArea, rectPerimeter, roundQuantity, slabCubicFeet, stairs, triangleArea, withWaste,
} from "@/lib/calculators/formulas";
import { parseNumber } from "@/lib/calculators/parse";
import { runCalculator, MAX_SECTIONS } from "@/lib/calculators/registry";
import { calculatorsFor, newInput, newSection, recordMatchesItem } from "@/lib/calculators/mapping";
import type { CalcInput, CalcSection } from "@/lib/calculators/types";

const d = (x: string | number) => new D(x);
const sec = (shape: string, values: Record<string, string>, extra: Partial<CalcSection> = {}): CalcSection => ({ id: `${shape}-${Math.random()}`, shape, values, ...extra });
const input = (sections: CalcSection[], options: Record<string, string> = {}): CalcInput => ({ sections, options });

describe("parseNumber", () => {
  it("parses plain decimals and strips thousands separators", () => {
    expect(parseNumber("12.5")).toMatchObject({ ok: true });
    expect(parseNumber("1,200").ok && parseNumber("1,200")).toBeTruthy();
    const r = parseNumber("1,200");
    expect(r.ok && r.value.toString()).toBe("1200");
    expect((parseNumber(".5") as { value: InstanceType<typeof D> }).value.toString()).toBe("0.5");
  });
  it("accepts feet-and-inches only on feet fields", () => {
    const a = parseNumber(`12'6"`, { feet: true });
    expect(a.ok && a.value.toString()).toBe("12.5");
    const b = parseNumber("10 ft 3 in", { feet: true });
    expect(b.ok && b.value.toString()).toBe("10.25");
    const c = parseNumber(`6"`, { feet: true });
    expect(c.ok && c.value.toString()).toBe("0.5");
    expect(parseNumber(`12'6"`).ok).toBe(false);
    // A bare "12 6" is ambiguous and rejected.
    expect(parseNumber("12 6", { feet: true }).ok).toBe(false);
  });
  it("rejects empty, negative, invalid and too-large values", () => {
    expect(parseNumber("")).toEqual({ ok: false, error: "empty" });
    expect(parseNumber("  ")).toEqual({ ok: false, error: "empty" });
    expect(parseNumber("-3")).toEqual({ ok: false, error: "negative" });
    expect(parseNumber("abc")).toEqual({ ok: false, error: "invalid" });
    expect(parseNumber("1e5")).toEqual({ ok: false, error: "invalid" });
    expect(parseNumber("Infinity")).toEqual({ ok: false, error: "invalid" });
    expect(parseNumber("200001", { max: 200000 })).toEqual({ ok: false, error: "too_large" });
  });
  it("accepts zero", () => {
    const z = parseNumber("0");
    expect(z.ok && z.value.isZero()).toBe(true);
  });
});

describe("formulas", () => {
  it("rectangle, triangle, circle and perimeter", () => {
    expect(rectArea(d(12), d(10)).toString()).toBe("120");
    expect(triangleArea(d(24), d(6)).toString()).toBe("72");
    expect(circleArea(d(10)).toFixed(4)).toBe("78.5398");
    expect(rectPerimeter(d(30), d(40)).toString()).toBe("140");
    expect(rectArea(d(0), d(10)).toString()).toBe("0");
  });
  it("waste factor", () => {
    expect(withWaste(d(100), d(10)).toString()).toBe("110");
    expect(withWaste(d(100), d(0)).toString()).toBe("100");
    expect(withWaste(d("333.33"), d("12.5")).toFixed(4)).toBe("374.9963");
  });
  it("roof pitch factor", () => {
    expect(pitchFactor(d(0)).toString()).toBe("1");
    expect(pitchFactor(d(6)).toFixed(4)).toBe("1.1180");
    expect(pitchFactor(d(12)).toFixed(4)).toBe("1.4142");
    expect(pitchFactor(d(4)).toFixed(4)).toBe("1.0541");
  });
  it("volumes", () => {
    expect(slabCubicFeet(d(20), d(10), d(4)).toFixed(4)).toBe("66.6667");
    expect(cubicYards(slabCubicFeet(d(20), d(10), d(4))).toFixed(4)).toBe("2.4691");
    expect(footingCubicFeet(d(100), d(16), d(8)).toFixed(4)).toBe("88.8889");
    expect(pierCubicFeet(d(12), d(4)).toFixed(4)).toBe("3.1416");
    expect(cubicYards(d(27)).toString()).toBe("1");
  });
  it("stairs from total rise", () => {
    const r = stairs({ totalRiseIn: d(30), treadDepthIn: d("10.5"), widthFt: d(4), runs: d(1), maxRiserIn: d("7.75") });
    expect(r.risers).toBe(4); // 30 / 7.75 = 3.87 → 4
    expect(r.treads).toBe(3);
    expect(r.riserHeightIn!.toString()).toBe("7.5");
    expect(r.treadAreaSf.toFixed(3)).toBe("10.500"); // 4 × 0.875 × 3
    expect(r.stringers).toBe(4); // 48/16 = 3 + 1
    expect(r.totalRunIn.toString()).toBe("31.5");
  });
  it("stairs: exact multiple of max riser does not add a riser", () => {
    const r = stairs({ totalRiseIn: d(31), treadDepthIn: d(10), widthFt: d(3), runs: d(1), maxRiserIn: d("7.75") });
    expect(r.risers).toBe(4);
  });
  it("stairs with known tread count and multiple runs", () => {
    const r = stairs({ treadCount: d(5), treadDepthIn: d(11), widthFt: d(3), runs: d(2), maxRiserIn: d("7.75") });
    expect(r.treads).toBe(10);
    expect(r.risers).toBe(12);
    expect(r.riserHeightIn).toBeNull();
    expect(r.treadAreaSf.toFixed(2)).toBe("27.50");
  });
  it("coverage, decking, labor", () => {
    expect(coverageUnits(d(1000), d(2), d(350), d(0)).toFixed(4)).toBe("5.7143");
    expect(coverageUnits(d(100), d(1), d(10), d(10)).toString()).toBe("11");
    expect(deckingLinearFeet(d(320), d("5.5"), d(0)).toFixed(4)).toBe("698.1818");
    expect(laborHours(d(1200), d(400), d(2), d(1)).toString()).toBe("7");
  });
  it("unit conversion", () => {
    expect(convertUnits(d(900), "square foot", "square yard")!.toString()).toBe("100");
    expect(convertUnits(d(2500), "square foot", "square")!.toString()).toBe("25");
    expect(convertUnits(d(54), "cubic foot", "cubic yard")!.toString()).toBe("2");
    expect(convertUnits(d(36), "inch", "linear foot")!.toString()).toBe("3");
    expect(convertUnits(d(10), "square meter", "square foot")!.toFixed(2)).toBe("107.64");
    expect(convertUnits(d(1), "square foot", "cubic yard")).toBeNull();
    expect(convertUnits(d(1), "bogus", "square foot")).toBeNull();
  });
  it("rounding: whole packages round up, measures round up to cents", () => {
    expect(roundQuantity(d("5.0001"), "gallon").value.toString()).toBe("6");
    expect(roundQuantity(d("5"), "box").value.toString()).toBe("5");
    expect(roundQuantity(d("12.341"), "square foot").value.toString()).toBe("12.35");
    expect(roundQuantity(d("12.34"), "square foot").value.toString()).toBe("12.34");
    // Float-like noise from square roots must not bump a whole number up.
    expect(roundQuantity(d("6.0000000000001"), "each").value.toString()).toBe("6");
    expect(roundQuantity(d("2.4691358"), "cubic yard").value.toString()).toBe("2.47");
  });
});

describe("area calculator", () => {
  it("adds multiple sections and subtracts openings, then waste", () => {
    const r = runCalculator("area", input([
      sec("wall", { length: "140", height: "9" }),
      sec("triangle", { base: "30", height: "8", count: "2" }),
      sec("opening", { width: "3", height: "5", count: "10" }, { deduct: true }),
    ], { waste: "10" }), "sf");
    // 1260 + 240 - 150 = 1350, × 1.1 = 1485
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe("1485");
    expect(r.unit).toBe("square foot");
    expect(r.lines.some((l) => l.deduct)).toBe(true);
    expect(r.formula).toMatch(/waste/);
  });
  it("converts to squares and square yards", () => {
    const sq = runCalculator("area", input([sec("rect", { length: "50", width: "30" })]), "sq");
    expect(sq.quantity).toBe("15");
    expect(sq.unit).toBe("square");
    const sy = runCalculator("area", input([sec("rect", { length: "10", width: "10" })]), "sy");
    expect(sy.quantity).toBe("11.12"); // 11.111 rounded up
  });
  it("accepts feet-inches inside sections", () => {
    const r = runCalculator("area", input([sec("rect", { length: `12'6"`, width: "10" })]), "sf");
    expect(r.quantity).toBe("125");
  });
  it("reports errors for negative, missing and invalid dimensions", () => {
    const neg = runCalculator("area", input([sec("rect", { length: "-5", width: "10" })]), "sf");
    expect(neg.ok).toBe(false);
    expect(neg.quantity).toBeNull();
    expect(neg.errors[0].message).toMatch(/negative/);
    const missing = runCalculator("area", input([sec("rect", { length: "5" })]), "sf");
    expect(missing.errors[0].message).toMatch(/Enter/);
    const bad = runCalculator("area", input([sec("rect", { length: "five", width: "10" })]), "sf");
    expect(bad.errors[0].message).toMatch(/not a number/);
    const frac = runCalculator("area", input([sec("rect", { length: "5", width: "10", count: "1.5" })]), "sf");
    expect(frac.errors[0].message).toMatch(/whole number/);
  });
  it("zero dimensions produce a zero result with a warning (never an error)", () => {
    const r = runCalculator("area", input([sec("rect", { length: "0", width: "10" })]), "sf");
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe("0");
    expect(r.warnings[0]).toMatch(/measures 0/);
  });
  it("rejects deductions larger than the area", () => {
    const r = runCalculator("area", input([sec("rect", { length: "5", width: "5" }), sec("opening", { width: "10", height: "10" }, { deduct: true })]), "sf");
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/Deductions/);
  });
  it("rejects absurdly large values and results", () => {
    const tooBig = runCalculator("area", input([sec("rect", { length: "100001", width: "1" })]), "sf");
    expect(tooBig.errors[0].message).toMatch(/larger than/);
    const huge = runCalculator("area", input([sec("rect", { length: "100000", width: "100000", count: "10000" })]), "sf");
    expect(huge.ok).toBe(false);
    expect(huge.errors[0].message).toMatch(/too large/);
  });
  it("waste must be 0-100%", () => {
    const r = runCalculator("area", input([sec("rect", { length: "10", width: "10" })], { waste: "150" }), "sf");
    expect(r.ok).toBe(false);
  });
  it("requires at least one section and caps the section count", () => {
    expect(runCalculator("area", input([]), "sf").ok).toBe(false);
    const many = Array.from({ length: MAX_SECTIONS + 1 }, () => sec("rect", { length: "1", width: "1" }));
    expect(runCalculator("area", input(many), "sf").ok).toBe(false);
  });
  it("edit and recalculate gives the new value (pure function of inputs)", () => {
    const i = input([sec("rect", { length: "10", width: "10" })]);
    expect(runCalculator("area", i, "sf").quantity).toBe("100");
    i.sections[0].values.width = "12";
    expect(runCalculator("area", i, "sf").quantity).toBe("120");
  });
});

describe("roof calculator", () => {
  it("applies the pitch factor per plane, waste, and converts to squares", () => {
    const r = runCalculator("roof", input([
      sec("plane", { length: "40", width: "15", pitch: "6", count: "2" }),
      sec("hip_face", { base: "30", height: "15", pitch: "6", count: "2" }),
    ], { measured: "plan", waste: "10" }), "sq");
    // planes: 600 × 1.118034 × 2 = 1341.64; faces: 225 × 1.118034 × 2 = 503.11; total 1844.75 × 1.1 = 2029.23 SF → 20.29 sq
    expect(r.ok).toBe(true);
    expect(r.unit).toBe("square");
    expect(r.quantity).toBe("20.3");
  });
  it("skips the pitch factor when measured on the roof surface", () => {
    const r = runCalculator("roof", input([sec("plane", { length: "40", width: "15", pitch: "6" })], { measured: "surface" }), "sf");
    expect(r.quantity).toBe("600");
  });
  it("requires a pitch when measuring horizontally and warns on very steep pitches", () => {
    const missing = runCalculator("roof", input([sec("plane", { length: "40", width: "15" })], { measured: "plan" }), "sf");
    expect(missing.ok).toBe(false);
    const steep = runCalculator("roof", input([sec("plane", { length: "10", width: "10", pitch: "30" })], { measured: "plan" }), "sf");
    expect(steep.ok).toBe(true);
    expect(steep.warnings.join(" ")).toMatch(/steep/);
    const flat = runCalculator("roof", input([sec("plane", { length: "10", width: "10", pitch: "0" })], { measured: "plan" }), "sf");
    expect(flat.quantity).toBe("100");
  });
});

describe("linear and perimeter calculators", () => {
  it("sums runs, subtracts gates, adds waste", () => {
    const r = runCalculator("linear", input([sec("run", { length: "100" }), sec("run", { length: "50", count: "2" }), sec("run", { length: "4" }, { deduct: true })], { waste: "5" }), "lf");
    expect(r.quantity).toBe("205.8"); // (200 − 4) × 1.05
  });
  it("J-channel around openings and conversion to pieces", () => {
    const lf = runCalculator("linear", input([sec("opening_trim", { width: "3", height: "5", sides: "4", count: "8" })]), "lf");
    expect(lf.quantity).toBe("128");
    const three = runCalculator("linear", input([sec("opening_trim", { width: "3", height: "7", sides: "3" })]), "lf");
    expect(three.quantity).toBe("17");
    const pcs = runCalculator("linear", input([sec("opening_trim", { width: "3", height: "5", count: "8" })], { pieceLength: "12.5" }), "pcs");
    expect(pcs.quantity).toBe("11"); // 128 / 12.5 = 10.24 → 11
    expect(pcs.unit).toBe("piece");
    const noLen = runCalculator("linear", input([sec("run", { length: "10" })]), "pcs");
    expect(noLen.ok).toBe(false);
  });
  it("perimeter of a rectangle", () => {
    const r = runCalculator("perimeter", input([sec("rect_perimeter", { length: "40", width: "30" })]), "lf");
    expect(r.quantity).toBe("140");
  });
});

describe("volume calculator", () => {
  it("slab plus footing plus piers with allowance", () => {
    const r = runCalculator("volume", input([
      sec("slab", { length: "24", width: "24", thickness: "4" }),
      sec("footing", { length: "96", width: "16", depth: "8" }),
      sec("pier", { diameter: "12", depth: "4", count: "4" }),
    ], { waste: "5" }), "cy");
    // 192 + 85.333 + 12.566 = 289.9 CF = 10.737 CY × 1.05 = 11.274 → 11.28
    expect(r.ok).toBe(true);
    expect(r.unit).toBe("cubic yard");
    expect(r.quantity).toBe("11.28");
  });
  it("multiple slabs", () => {
    const r = runCalculator("volume", input([sec("slab", { length: "20", width: "10", thickness: "4" }), sec("slab", { length: "10", width: "10", thickness: "6" })]), "cy");
    // 66.667 + 50 = 116.667 CF = 4.321 CY → 4.33
    expect(r.quantity).toBe("4.33");
  });
});

describe("stairs calculator", () => {
  it("estimates counts from rise and returns tread area", () => {
    const r = runCalculator("stairs", input([], { totalRise: "30", treadDepth: "10.5", width: "4", runs: "1", maxRiser: "7.75", stringerSpacing: "16" }), "tread_area");
    expect(r.quantity).toBe("10.5");
    expect(r.unit).toBe("square foot");
    expect(runCalculator("stairs", input([], { totalRise: "30", treadDepth: "10.5", width: "4" }), "risers").quantity).toBe("4");
    expect(runCalculator("stairs", input([], { totalRise: "30", treadDepth: "10.5", width: "4" }), "treads").quantity).toBe("3");
    expect(runCalculator("stairs", input([], { totalRise: "30", treadDepth: "10.5", width: "4" }), "stringers").quantity).toBe("4");
  });
  it("warns about code-related limits without blocking", () => {
    const r = runCalculator("stairs", input([], { treadCount: "2", totalRise: "30", treadDepth: "9", width: "2.5", maxRiser: "8" }), "tread_area");
    expect(r.ok).toBe(true);
    const w = r.warnings.join(" ");
    expect(w).toMatch(/above your 8 in maximum/); // 30/3 = 10 in risers
    expect(w).toMatch(/under 10 in/);
    expect(w).toMatch(/under 36 in/);
    expect(w).toMatch(/local code governs/);
  });
  it("flags a tall rise that needs a landing", () => {
    const r = runCalculator("stairs", input([], { totalRise: "160", treadDepth: "10", width: "3" }), "treads");
    expect(r.warnings.join(" ")).toMatch(/landing/);
  });
  it("needs a rise or a tread count", () => {
    const r = runCalculator("stairs", input([], { treadDepth: "10", width: "3" }), "treads");
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/total rise/);
  });
});

describe("coverage, boards, conversion and labor calculators", () => {
  it("paint gallons with coats and waste, rounded up", () => {
    const r = runCalculator("coverage", input([sec("wall", { length: "120", height: "8" }), sec("opening", { width: "3", height: "7", count: "2" }, { deduct: true })], { coveragePer: "350", coats: "2", waste: "10" }), "gallon");
    // (960 - 42) = 918 × 2 × 1.1 = 2019.6 / 350 = 5.77 → 6
    expect(r.quantity).toBe("6");
    expect(r.unit).toBe("gallon");
    expect(r.rounding).toMatch(/whole gallons/);
  });
  it("tile boxes", () => {
    const r = runCalculator("coverage", input([sec("known_area", { area: "212" })], { coveragePer: "15.5", waste: "10" }), "box");
    expect(r.quantity).toBe("16"); // 233.2 / 15.5 = 15.04 → 16
  });
  it("coverage per package must be positive", () => {
    expect(runCalculator("coverage", input([sec("known_area", { area: "100" })], { coveragePer: "0" }), "gallon").ok).toBe(false);
    expect(runCalculator("coverage", input([sec("known_area", { area: "100" })], {}), "gallon").ok).toBe(false);
  });
  it("decking boards from deck sections", () => {
    const r = runCalculator("boards", input([sec("rect", { length: "16", width: "20" })], { boardLength: "16", faceWidth: "5.5", gap: "0.1875", waste: "10" }), "boards");
    // 320 × 12 / 5.6875 = 675.16 LF × 1.1 = 742.68 / 16 = 46.42 → 47
    expect(r.quantity).toBe("47");
    const lf = runCalculator("boards", input([sec("rect", { length: "16", width: "20" })], { boardLength: "16", faceWidth: "5.5" }), "lf");
    expect(lf.quantity).toBe("698.19");
  });
  it("unit conversion respects dimensions", () => {
    expect(runCalculator("convert", input([], { value: "2,400", from: "square foot" }), "square").quantity).toBe("24");
    expect(runCalculator("convert", input([], { value: "81", from: "cubic foot" }), "cubic yard").quantity).toBe("3");
    expect(runCalculator("convert", input([], { value: "10", from: "linear foot" }), "square foot").ok).toBe(false);
  });
  it("labor hours and crew days", () => {
    expect(runCalculator("labor", input([], { quantity: "1200", rate: "400", crew: "2", setup: "1" }), "hour").quantity).toBe("7");
    // (3 + 0.5) / 8 = 0.4375 → 0.44
    expect(runCalculator("labor", input([], { quantity: "1200", rate: "400", crew: "2", setup: "1", hoursPerDay: "8" }), "day").quantity).toBe("0.44");
    expect(runCalculator("labor", input([], { quantity: "1200", rate: "0" }), "hour").ok).toBe(false);
  });
});

describe("calculator mapping", () => {
  const ids = (name: string, unit: string, trades: string[]) => calculatorsFor({ name, unit }, trades).map((p) => p.calc);
  it("roofing squares get the roof calculator first", () => {
    expect(ids("Architectural shingles", "square", ["roofing"])[0]).toBe("roof");
    expect(ids("Ridge vent", "linear foot", ["roofing"])[0]).toBe("linear");
  });
  it("siding gets wall area with gable and opening sections", () => {
    const p = calculatorsFor({ name: "Siding panels", unit: "square" }, ["siding"])[0];
    expect(p.calc).toBe("area");
    expect(p.output).toBe("sq");
    const i = newInput(p);
    expect(i.sections.map((s) => s.shape)).toEqual(["wall", "triangle", "opening"]);
    expect(i.sections[2].deduct).toBe(true);
    expect(ids("J-channel", "piece", ["siding"])[0]).toBe("linear");
    expect(calculatorsFor({ name: "J-channel", unit: "piece" }, ["siding"])[0].shape).toBe("opening_trim");
    expect(ids("Starter strip", "linear foot", ["siding"])[0]).toBe("perimeter");
  });
  it("decks: boards, stairs, railing, fascia", () => {
    expect(ids("Composite deck boards", "each", ["decks"])[0]).toBe("boards");
    expect(ids("Stair stringers", "each", ["decks"])[0]).toBe("stairs");
    expect(calculatorsFor({ name: "Stair stringers", unit: "each" }, ["decks"])[0].output).toBe("stringers");
    expect(ids("Railing materials", "linear foot", ["decks"])[0]).toBe("linear");
    expect(ids("Fascia boards", "linear foot", ["decks"])[0]).toBe("perimeter");
    expect(ids("Fascia boards", "each", ["decks"])[0]).toBe("perimeter");
    expect(calculatorsFor({ name: "Fascia boards", unit: "each" }, ["decks"])[0].output).toBe("each");
    const fascia = runCalculator("perimeter", input([sec("rect_perimeter", { length: "16", width: "20" })], { pieceLength: "16", waste: "10" }), "each");
    expect(fascia.quantity).toBe("5"); // 72 LF × 1.1 ÷ 16 ft = 4.95 → 5 boards
    expect(fascia.unit).toBe("each");
    expect(ids("Decking installation", "square foot", ["decks"])[0]).toBe("area");
  });
  it("concrete: volume for yards, footing shape for footings", () => {
    expect(ids("Ready-mix concrete", "cubic yard", ["concrete"])[0]).toBe("volume");
    expect(calculatorsFor({ name: "Concrete footings", unit: "cubic yard" }, ["decks"])[0].shape).toBe("footing");
    expect(ids("Form boards", "linear foot", ["concrete"])[0]).toBe("perimeter");
  });
  it("kitchens & baths", () => {
    expect(calculatorsFor({ name: "Countertops", unit: "square foot" }, ["kitchens"])[0].label).toMatch(/Countertop/);
    expect(calculatorsFor({ name: "Backsplash tile", unit: "square foot" }, ["kitchens"])[0].label).toMatch(/Backsplash/);
    expect(calculatorsFor({ name: "Wall tile", unit: "square foot" }, ["bathrooms"])[0].shape).toBe("wall");
    expect(ids("Thinset and grout", "bag", ["bathrooms"])[0]).toBe("coverage");
    expect(ids("Under-cabinet lighting", "linear foot", ["kitchens"])[0]).toBe("linear");
  });
  it("never offers calculators that don't fit the unit", () => {
    expect(ids("Building permit", "each", ["roofing"])).toEqual([]);
    expect(ids("Site cleanup", "lump sum", ["roofing"])).toEqual([]);
    expect(ids("Stone base", "ton", ["concrete"])).toEqual([]);
    expect(ids("Concrete footings", "each", ["decks"])).toEqual([]);
    expect(ids("Crew labor", "hour", ["pressure-washing"])).toEqual(["labor"]);
  });
  it("de-duplicates and includes conversion for measured units", () => {
    const list = ids("Siding panels", "square", ["siding"]);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain("convert");
  });
  it("washing trades", () => {
    expect(ids("Driveway cleaning", "square foot", ["pressure-washing"])[0]).toBe("area");
    expect(ids("House siding soft wash", "square foot", ["soft-washing"])[0]).toBe("area");
    expect(calculatorsFor({ name: "House siding soft wash", unit: "square foot" }, ["soft-washing"])[0].shape).toBe("wall");
    expect(ids("Roof soft wash", "square foot", ["soft-washing"])[0]).toBe("roof");
    expect(calculatorsFor({ name: "Roof soft wash", unit: "square foot" }, ["soft-washing"])[0].output).toBe("sf");
    expect(ids("Fence cleaning", "linear foot", ["pressure-washing"])[0]).toBe("linear");
  });
});

describe("calculator inputs", () => {
  it("new inputs pre-fill safe defaults but never prices or assumed dimensions", () => {
    const i = newInput({ calc: "roof" });
    expect(i.sections[0].values.pitch).toBeUndefined();
    expect(i.sections[0].values.count).toBe("1");
    expect(i.options.waste).toBe("0");
    const v = newInput({ calc: "volume" });
    expect(v.sections[0].values.thickness).toBeUndefined();
    const c = newInput({ calc: "coverage" });
    expect(c.options.coveragePer).toBeUndefined();
  });
  it("new sections get unique ids", () => {
    const a = newSection("rect");
    const b = newSection("rect");
    expect(a.id).not.toBe(b.id);
  });
  it("detects a manual quantity override after applying", () => {
    const rec = { v: 1 as const, calc: "area" as const, output: "sf", input: input([]), result: "120", unit: "square foot", appliedAt: "x" };
    expect(recordMatchesItem(rec, { quantity: "120", unit: "square foot" })).toBe(true);
    expect(recordMatchesItem(rec, { quantity: "120.00", unit: "square foot" })).toBe(true);
    expect(recordMatchesItem(rec, { quantity: "125", unit: "square foot" })).toBe(false);
    expect(recordMatchesItem(rec, { quantity: "120", unit: "square" })).toBe(false);
    expect(recordMatchesItem(undefined, { quantity: "120", unit: "square foot" })).toBe(false);
  });
});
