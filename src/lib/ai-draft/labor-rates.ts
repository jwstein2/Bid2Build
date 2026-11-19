/**
 * Local labor rates for AI starting-point drafts.
 *
 * Source: U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics (OEWS),
 * May 2025 state estimates (https://www.bls.gov/oes/tables.htm, file oesm25st.zip, column H_MEDIAN).
 * BLS data is a U.S. government work (public domain). Values are median HOURLY WAGES, not billing
 * rates: the draft multiplies them by a labor burden the contractor can change (payroll taxes,
 * workers' comp, insurance). Markup or margin is applied later by the estimate, as for any cost.
 *
 * Update once a year when BLS publishes the next May estimates (usually in spring).
 */
import { resolveGeo } from "../market/geo";

export const LABOR_DATA = { source: "BLS OEWS", period: "May 2025", url: "https://www.bls.gov/oes/tables.htm" } as const;

/** Default burden on top of the wage. Shown to the contractor and editable in the draft panel. */
export const DEFAULT_LABOR_BURDEN = 1.35;
export const MIN_LABOR_BURDEN = 1;
export const MAX_LABOR_BURDEN = 3;

/** Crew types the AI may assign to a labor line, in the column order of WAGES below. */
export const LABOR_TRADES = [
  "carpenter", "electrician", "plumber", "painter", "roofer", "laborer", "drywall", "tile", "concrete",
  "flooring", "mason", "insulation", "fence", "hvac", "handyman", "landscaping", "glazier", "sheet_metal",
] as const;
export type LaborTrade = (typeof LABOR_TRADES)[number];

export const LABOR_TRADE_LABELS: Record<LaborTrade, { label: string; soc: string; occupation: string }> = {
  carpenter: { label: "Carpenter", soc: "47-2031", occupation: "Carpenters" },
  electrician: { label: "Electrician", soc: "47-2111", occupation: "Electricians" },
  plumber: { label: "Plumber", soc: "47-2152", occupation: "Plumbers, Pipefitters, and Steamfitters" },
  painter: { label: "Painter", soc: "47-2141", occupation: "Painters, Construction and Maintenance" },
  roofer: { label: "Roofer", soc: "47-2181", occupation: "Roofers" },
  laborer: { label: "Laborer", soc: "47-2061", occupation: "Construction Laborers" },
  drywall: { label: "Drywall installer", soc: "47-2081", occupation: "Drywall and Ceiling Tile Installers" },
  tile: { label: "Tile setter", soc: "47-2044", occupation: "Tile and Stone Setters" },
  concrete: { label: "Concrete finisher", soc: "47-2051", occupation: "Cement Masons and Concrete Finishers" },
  flooring: { label: "Floor layer", soc: "47-2042", occupation: "Floor Layers, Except Carpet, Wood, and Hard Tiles" },
  mason: { label: "Mason", soc: "47-2021", occupation: "Brickmasons and Blockmasons" },
  insulation: { label: "Insulation installer", soc: "47-2131", occupation: "Insulation Workers, Floor, Ceiling, and Wall" },
  fence: { label: "Fence installer", soc: "47-4031", occupation: "Fence Erectors" },
  hvac: { label: "HVAC technician", soc: "49-9021", occupation: "Heating, Air Conditioning, and Refrigeration Mechanics and Installers" },
  handyman: { label: "Handyman", soc: "49-9071", occupation: "Maintenance and Repair Workers, General" },
  landscaping: { label: "Landscaper", soc: "37-3011", occupation: "Landscaping and Groundskeeping Workers" },
  glazier: { label: "Glazier", soc: "47-2121", occupation: "Glaziers" },
  sheet_metal: { label: "Sheet metal worker", soc: "47-2211", occupation: "Sheet Metal Workers" },
};

/** Default crew for a project trade when a labor line doesn't say. */
export const TRADE_DEFAULT_LABOR: Record<string, LaborTrade> = {
  roofing: "roofer", siding: "carpenter", decks: "carpenter", concrete: "concrete", kitchens: "carpenter",
  bathrooms: "carpenter", "interior-remodeling": "carpenter", "exterior-remodeling": "carpenter", drywall: "drywall",
  painting: "painter", electrical: "electrician", plumbing: "plumber", hvac: "hvac", flooring: "flooring", tile: "tile",
  framing: "carpenter", "finish-carpentry": "carpenter", "cabinets-countertops": "carpenter", "windows-doors": "carpenter",
  insulation: "insulation", gutters: "sheet_metal", fencing: "fence", landscaping: "landscaping", "tree-removal": "landscaping", "tree-trimming": "landscaping", "pressure-washing": "laborer",
  "soft-washing": "laborer", cleaning: "laborer", excavation: "laborer", foundations: "concrete", masonry: "mason", "asphalt-paving": "laborer",
  demolition: "laborer", basements: "carpenter", additions: "carpenter", garages: "carpenter", "pole-barns": "carpenter",
  "commercial-remodeling": "carpenter", "general-contracting": "carpenter", handyman: "handyman", other: "handyman",
};

// State (and US) median hourly wage per LABOR_TRADES column. Blank = BLS did not publish (falls back to US).
const WAGES = `
AL:23.18,26.78,28.21,21.12,21.96,17.74,23.08,21.54,21.5,18.62,23.9,23.43,19.15,23.26,20.97,17.13,21.89,22.85
AK:35.51,43,45.15,29.32,32.09,27.91,35.43,,44.69,44.64,,27.15,31.06,37.23,28.97,22.93,30.29,45.48
AZ:28.17,29.36,29.84,23.2,22.76,22.4,24.18,25,28.32,21.51,28.49,20.29,22.24,28.56,22.9,18.71,27.19,24.16
AR:22.96,23.59,23.39,19.28,22.82,18.09,21.42,18.74,22.23,19.59,26.49,21.03,22.19,23.13,20.87,17.2,21.49,22.03
CA:36.5,36.62,35.01,28.38,30.58,28.98,31.67,28.31,30.15,29.43,33.2,23.48,26.95,34.88,27.41,21.9,30.79,36.82
CO:30.21,29.92,30.4,25.47,24.88,23.03,29.7,27.74,29.18,22.13,31.37,24.42,23.26,31.35,24.65,22,29.97,27.83
CT:30.8,37.28,37.16,28.12,29.84,28.03,29.08,30.36,28.19,22.7,32.67,23.34,25.57,36.83,27.7,21.99,30.69,37.86
DE:28.46,30.63,31.11,28.14,28.58,21.9,24.12,,27.42,,32,25.75,24.34,29.96,24.11,17.96,,29.55
DC:29.67,37.97,48.57,28.61,29.69,24.05,,,29.65,,30.98,,,40.57,29,23.46,37.69,
FL:23.98,27.52,25.44,22.85,22.88,21.17,23.54,22.73,23.4,27.41,25.37,22.65,21.9,27.24,22.15,17.84,22.61,23.87
GA:23.72,28.04,27.5,23.24,22.57,18.74,28.01,23,22.23,22.13,24.35,22.99,17.78,27.11,22.92,18.25,20.84,27.31
HI:41,46.38,37.53,32.8,28.64,37.07,50.4,38.11,46.1,37.15,38.1,,,31.47,27.86,22.08,38.85,46.32
ID:25,30.29,25.18,21.58,27.78,22.57,21.05,23.05,27.12,,30.06,19.98,,27.04,23.17,20,28.77,22.29
IL:37.98,47.87,48.05,29.45,37.45,29.18,30.38,32.29,37.58,33.6,43.26,25.48,24.38,37.21,27.27,21.05,29.73,41.65
IN:30.23,32.93,36.69,24.16,27.88,24.07,23.95,23.29,29.46,24.39,35.15,26.26,22.84,29.05,23.99,18.3,28.95,30.79
IA:27.75,29.26,30.72,23.9,23.39,23.31,24.53,26.13,27.99,26.42,33.38,26.84,25.25,29.17,25.08,18.71,27.56,31.95
KS:27.39,31.66,31.36,21.88,22.69,21.56,19.18,26.4,25.06,22.1,28.47,24.77,22.66,29.07,22.7,18.91,22.64,30.13
KY:25.33,28.71,30.84,23.13,22.57,21.98,23.24,22.78,24.14,24.22,28.76,23.91,,28.18,22.5,17.63,23.61,29.17
LA:24,29.59,30.62,22.31,23.44,18.38,22.8,21.52,23.64,20.32,27.62,22.76,24.89,28.2,21.13,16.76,22.67,24.19
ME:29.88,36.24,30.77,28.5,24.1,22.32,28.89,34,26.77,25.67,20.54,22.97,21.78,30.37,23.76,22.1,22.97,29.87
MD:30.27,35.33,31.44,23.62,28.89,22.58,26.29,21.96,24.98,23.02,28.38,28.09,,33.67,24.76,18.93,28.79,30.08
MA:36.16,38.18,45.14,27.65,34.98,30.48,33.42,39.02,30.69,38.12,45.65,23.53,23.28,37.16,28.04,23.4,48.47,39.47
MI:29.66,36.67,38.56,24.35,28.62,23.84,28.1,23.05,28.78,22.5,30.53,22.35,22.02,29.26,22.87,18.33,25.37,31.01
MN:31.22,37.58,45.39,27.54,35.81,28.97,29.46,33.92,32.13,28.55,45.78,26.13,27.53,36.71,28.46,22.41,31.79,35.08
MS:23.39,29.26,26.67,21.54,21.61,18.13,17.94,18.81,21.14,23.67,23.47,30.23,18.61,23.41,21.32,15.21,17.67,23.8
MO:29.25,31.45,32.11,27.65,23.35,27.28,30.09,29.13,29.51,26.3,34.8,26.94,20.81,28.82,23.26,18.52,24.73,30.56
MT:28.28,36.9,38.44,28.03,28.38,23.96,28.92,28.21,29.63,18.13,26.94,23.13,26.79,29.26,22.54,21.8,23.73,29.53
NE:24.19,29.24,29.31,22.73,22.34,22.72,23.38,28.53,23.8,,29.42,35.16,24.1,28.77,24.38,18.82,24.13,30.98
NV:29.99,35.37,29.62,27.11,24.56,23.55,25.13,29.42,29.44,28.15,29.17,22.36,22.57,29.09,25.17,18.66,23.8,22.47
NH:29.42,30.21,32.12,23.88,28.76,24.03,29.79,23.99,26.06,,32.16,24.67,24.45,35.51,25.4,21.58,28.29,28.75
NJ:30.77,37.14,37.61,28.49,36.83,30.8,36.09,29.99,29.52,28.77,37.03,25.36,27.26,35.79,26.35,19.88,34.08,44.64
NM:28.71,28.07,29.54,22.23,21.78,18.46,25.91,21.42,23.67,23.94,21.63,23.3,21.37,24.17,22,18.06,22.57,27.27
NY:34.77,37.86,37.26,28.64,31.74,26.89,29.46,29.45,30.79,29.5,40.58,28.41,23.08,35.78,27.79,21.56,29.69,35.46
NC:23.61,27.31,27.44,21.21,23.56,21.5,21.67,21.47,22.49,24.86,24.01,20.67,18.8,27.53,23.03,18.22,22.2,24.39
ND:27.83,31.59,30.56,26.38,28.72,23.59,21.69,20.49,27.74,23.1,38.43,22.33,23.71,35.81,23.96,19.61,29.71,31.34
OH:29.24,31.11,30.45,23.77,23.74,26.96,29.53,22.18,30.28,28.59,34.11,28.08,23.02,30.06,25.68,18.38,28.94,35.96
OK:22.55,29.33,27.87,21.59,21,18.92,22.15,21.32,22,18.29,24.34,22.54,18.21,27.67,20.55,17.2,21.82,31.56
OR:30.23,48.71,46.66,23.51,28.35,24.45,35.35,28.27,32.95,27.14,38.2,28.95,21.43,30.26,26.13,21.65,34.08,35.46
PA:28.54,32.5,32.73,25.06,26.79,23.75,29.4,33.77,29.62,28.87,33.44,24.33,28.17,30,23.7,18.99,28.27,29.52
RI:29.25,35.62,36.77,20,29.63,27.52,22.65,23.64,30.26,,38.12,,22.33,32.39,24.47,21.51,29.64,31.3
SC:24.36,28.24,25.93,19.64,22,20.65,21.8,20.92,23.73,23.97,23.56,22.61,18.25,27.22,23.02,17.65,24.35,24
SD:23.14,29.51,24.82,23.15,22.94,21.98,23.49,24.34,22.67,28.33,29.03,22.03,23.26,29.51,23.13,17.01,22.66,22.98
TN:24.44,29.37,28.17,20.78,21.97,21.64,22.84,20.95,23.04,23.99,30.7,23.28,21.79,26.68,22.71,17.8,23.37,28.45
TX:23.51,28.16,28.77,21.86,22.13,19.53,22.88,22.61,22.84,20.71,27.12,23.43,17.92,27.77,22.44,17.66,22.95,26.08
UT:25.17,29.81,29.76,22.14,23.4,22.38,24.53,23.72,27.13,23.03,29.06,19.27,23.42,28.24,24.26,19.59,24.75,30.36
VT:30,30.49,29.89,25.54,28.39,23.36,28.76,26.87,29.4,24.62,28.65,25.76,,29.88,26.69,22.23,29.04,28
VA:26.77,30.24,29.07,22.82,23.28,20.94,26.84,23.5,24.49,24.25,26.29,21.54,19.26,28.72,23.79,18.46,28.49,25.1
WA:35.67,45.78,38.96,28.68,29.16,27.75,35.16,37.46,37.27,27.31,40,32.57,24.93,36.38,28.44,22.57,32.14,47.38
WV:23.42,31.16,27.39,21.26,24.6,20.51,,24.47,24.98,21.82,22.4,17.01,21.65,23.49,18.7,15.5,23.95,34.81
WI:29.65,36.8,39.04,24.08,28.54,26.97,28.83,30.14,30.89,25.42,38.52,23.81,24.72,29.67,26.83,19.82,30,37.38
WY:27.33,36.59,30.01,22.7,21.95,22.13,21.15,,28.1,,28.87,22.21,19.11,26.3,23.03,18.42,26.46,28.24
US:29.12,30.38,30.67,23.75,26.65,22.66,28.33,26.77,27.41,27.15,29.87,23.62,23.07,29.33,23.84,18.82,27.44,29.71
`;

const TABLE: Map<string, (number | null)[]> = new Map(
  WAGES.trim().split("\n").map((line) => {
    const [st, vals] = line.split(":");
    return [st, vals.split(",").map((v) => (v === "" ? null : Number(v)))];
  }),
);

export interface LaborWage {
  trade: LaborTrade;
  /** Median hourly wage, USD. */
  wage: number;
  /** Where the number applies: a state code, or "US" when the state has no published value. */
  area: string;
  occupation: string;
  soc: string;
}

export const isLaborTrade = (v: unknown): v is LaborTrade => typeof v === "string" && (LABOR_TRADES as readonly string[]).includes(v);

/** Median wage for a crew in a state, falling back to the national median. */
export function laborWage(trade: LaborTrade, state: string | null | undefined): LaborWage {
  const col = LABOR_TRADES.indexOf(trade);
  const meta = LABOR_TRADE_LABELS[trade];
  const st = state?.toUpperCase() ?? "";
  const local = TABLE.get(st)?.[col];
  if (typeof local === "number") return { trade, wage: local, area: st, occupation: meta.occupation, soc: meta.soc };
  return { trade, wage: TABLE.get("US")![col]!, area: "US", occupation: meta.occupation, soc: meta.soc };
}

/** Wages for the given crews at a project location (ZIP wins over state, like everywhere else). */
export function laborWagesFor(location: { zip?: string; state?: string }, trades: LaborTrade[]): { state: string | null; wages: LaborWage[] } {
  const state = resolveGeo(location).state;
  return { state, wages: [...new Set(trades)].map((t) => laborWage(t, state)) };
}

export function clampBurden(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_LABOR_BURDEN;
  return Math.min(MAX_LABOR_BURDEN, Math.max(MIN_LABOR_BURDEN, Math.round(v * 100) / 100));
}
