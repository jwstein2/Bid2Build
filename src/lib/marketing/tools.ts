/**
 * Free public calculators (/tools). Each quantity tool reuses the builder's own calculator engine
 * (src/lib/calculators), so a result on the public page is exactly what the builder would compute.
 *
 * "Send this as a bid" opens /start/<trade>?tool=<slug>&q=<quantity>: the new draft gets ONE line
 * item (the matching template item) with that quantity and no price. No account is needed.
 * The measurements travel in sessionStorage (never in the URL) so the builder can show them on the
 * line's calculator; the server never sees them.
 */
import type { CalcId, CalcInput } from "@/lib/calculators/types";

export interface QuantityTool {
  kind: "quantity";
  slug: string;
  /** Short name for menus and cards. */
  name: string;
  /** <title> and H1. */
  title: string;
  description: string;
  calc: CalcId;
  output: string;
  /** Shapes offered on the public page (subset of the calculator's shapes). */
  shapes: string[];
  /** Trade the bid starts in, and the template line item that receives the quantity. */
  trade: string;
  item: { name: string; unit: string };
  /** Options pre-filled on the public page. Measurements only, never prices. */
  options?: Record<string, string>;
  intro: string;
  steps: { name: string; text: string }[];
  faqs: { q: string; a: string }[];
  /** Related guide slug under /learn, if any. */
  guide?: string;
}

export interface MarkupTool {
  kind: "markup";
  slug: string;
  name: string;
  title: string;
  description: string;
  intro: string;
  steps: { name: string; text: string }[];
  faqs: { q: string; a: string }[];
  guide?: string;
}

export type PublicTool = QuantityTool | MarkupTool;

export const TOOLS: PublicTool[] = [
  {
    kind: "quantity",
    slug: "concrete-calculator",
    name: "Concrete calculator",
    title: "Concrete Calculator: Cubic Yards for Slabs, Footings and Piers",
    description: "Free concrete calculator for contractors. Enter slab, footing or pier measurements and get cubic yards with your allowance, then turn it into a bid.",
    calc: "volume",
    output: "cy",
    shapes: ["slab", "footing", "pier"],
    trade: "concrete",
    item: { name: "Ready-mix concrete", unit: "cubic yard" },
    intro: "Add each slab, footing or pier, set your allowance for subgrade variation and spillage, and see the cubic yards to order with every step of the math shown.",
    steps: [
      { name: "Measure each pour", text: "Enter length and width in feet and thickness in inches for each slab. Feet and inches like 12'6\" work too." },
      { name: "Add footings or piers", text: "Add a section for continuous footings or round piers and post holes. Mark a section as Subtract to leave out a block-out." },
      { name: "Set your allowance", text: "Enter the overage you normally order for subgrade variation and spillage." },
      { name: "Send it as a bid", text: "Press Send this as a bid. A concrete estimate opens with Ready-mix concrete already set to your cubic yards. You add your own prices." },
    ],
    faqs: [
      { q: "How do I convert a slab to cubic yards?", a: "Multiply length × width in feet by the thickness in feet (inches ÷ 12), then divide by 27, because one cubic yard is 27 cubic feet. A 10 × 10 ft slab at 4 inches is 33.3 cubic feet, or 1.235 cubic yards, which the calculator rounds up to 1.24." },
      { q: "How is the result rounded?", a: "Cubic yards are rounded up to two decimal places, the same way the Built2Bid estimate builder rounds them. Your supplier may sell in quarter- or half-yard steps, so round to what you will actually order." },
      { q: "Does the calculator include prices?", a: "No. It calculates quantity only. When you send it as a bid you enter your own costs, so nothing is priced with made-up numbers." },
    ],
  },
  {
    kind: "quantity",
    slug: "deck-board-calculator",
    name: "Deck board calculator",
    title: "Deck Board Calculator: How Many Deck Boards Do I Need?",
    description: "Free deck board calculator for contractors. Enter the deck size, board length, face width and gap to get the number of boards, then turn it into a bid.",
    calc: "boards",
    output: "boards",
    shapes: ["rect", "known_area", "triangle", "circle"],
    trade: "decks",
    item: { name: "Composite deck boards", unit: "each" },
    intro: "Enter the deck area, your board length, face width and gap. The calculator works out the linear feet of board and the number of boards, with your waste allowance.",
    steps: [
      { name: "Enter the deck size", text: "Add the deck as one or more rectangles, or type a known area. Subtract cut-outs like a hot tub opening." },
      { name: "Describe the boards", text: "Enter the board length in feet and the actual face width in inches (5.5 in for a typical 5/4×6). Add the gap between boards." },
      { name: "Set your waste", text: "Enter the waste allowance you normally use for cuts and layout." },
      { name: "Send it as a bid", text: "Press Send this as a bid. A deck estimate opens with Composite deck boards already set to your board count. You add your own prices." },
    ],
    faqs: [
      { q: "How do you calculate how many deck boards you need?", a: "Board linear feet = deck area in square feet × 12 ÷ (board face width + gap, in inches). Add your waste allowance, then divide by the board length to get the number of boards." },
      { q: "What face width should I use?", a: "Use the actual width of the board, not the nominal size. A 5/4×6 or 2×6 board is usually about 5.5 inches wide. Check the product sheet for the exact figure." },
      { q: "Is the board count rounded up?", a: "Yes. The number of boards is rounded up to a whole board, the same way the Built2Bid estimate builder does it." },
    ],
  },
  {
    kind: "quantity",
    slug: "roofing-calculator",
    name: "Roofing calculator",
    title: "Roofing Calculator: Roof Squares from Measurements and Pitch",
    description: "Free roofing square calculator for contractors. Enter each roof plane and its pitch, add waste, and get roofing squares, then turn it into a bid.",
    calc: "roof",
    output: "sq",
    shapes: ["plane", "hip_face", "known_area"],
    trade: "roofing",
    item: { name: "Architectural shingles", unit: "square" },
    intro: "Measure each roof plane from the ground or a plan, enter its pitch, and the calculator applies the pitch factor, adds your waste and converts to squares (100 square feet).",
    steps: [
      { name: "Measure each plane", text: "Enter the length along the eave and the width from eave to ridge for each plane, measured horizontally. Add triangular hip ends separately." },
      { name: "Enter the pitch", text: "Enter the rise in inches per 12 inches of run, for example 6 for a 6/12 roof. The pitch factor is applied for you." },
      { name: "Set your waste", text: "Enter the waste allowance you use for cuts, hips and valleys." },
      { name: "Send it as a bid", text: "Press Send this as a bid. A roofing estimate opens with Architectural shingles already set to your squares. You add your own prices." },
    ],
    faqs: [
      { q: "What is a roofing square?", a: "A roofing square is 100 square feet of roof surface. Shingles and roofing labor are usually priced per square." },
      { q: "How does pitch change the roof area?", a: "A sloped roof has more surface than its footprint. The pitch factor is √(1 + (rise ÷ 12)²). For a 6/12 roof it is about 1.118, so 1,000 square feet of footprint is about 1,118 square feet of roof." },
      { q: "What if I measured on the roof itself?", a: "Choose \"On the roof surface\" under Dimensions measured. The calculator then skips the pitch factor, because your measurements already include the slope." },
    ],
  },
  {
    kind: "markup",
    slug: "markup-margin-calculator",
    name: "Markup and margin calculator",
    title: "Markup and Margin Calculator for Contractors",
    description: "Free markup to margin calculator. Enter your cost and a markup or target margin to see the price, profit and the matching percentage, then start a bid with it.",
    intro: "Enter your job cost and either a markup or a target margin. You see the selling price, the profit, and the other percentage, so 25% markup is never mistaken for 25% margin.",
    steps: [
      { name: "Enter your cost", text: "Type the total cost of the job: materials, labor, equipment and subs." },
      { name: "Choose markup or margin", text: "Pick whether you think in markup (a percent of cost) or margin (a percent of the price), then enter the percentage." },
      { name: "Read the result", text: "See the price, the profit, and the equivalent percentage the other way." },
      { name: "Start a bid with it", text: "Press Start a bid with this pricing. The new estimate uses the same markup or margin. You add your own costs." },
    ],
    faqs: [
      { q: "What is the difference between markup and margin?", a: "Markup is profit as a percent of cost. Margin is profit as a percent of the selling price. A $10,000 job sold for $12,500 has a 25% markup but a 20% margin." },
      { q: "How do I convert markup to margin?", a: "Margin = markup ÷ (100 + markup) × 100. For example, 25% markup is 25 ÷ 125 = 20% margin." },
      { q: "How do I convert margin to markup?", a: "Markup = margin ÷ (100 − margin) × 100. For example, a 20% margin needs 20 ÷ 80 = 25% markup." },
    ],
    guide: "markup-vs-margin",
  },
];

export const toolBySlug = (slug: string | undefined | null): PublicTool | undefined => TOOLS.find((t) => t.slug === slug);

export const quantityToolForTrade = (trade: string): QuantityTool | undefined =>
  TOOLS.find((t): t is QuantityTool => t.kind === "quantity" && t.trade === trade);

/* ----------------------------------------- Handoff ------------------------------------------ */

/** sessionStorage key for the measurements behind a "Send this as a bid" handoff. */
export const TOOL_HANDOFF_KEY = "b2b:tool-calc";

export interface ToolHandoff {
  tool: string;
  quantity: string;
  input: CalcInput;
}

/** A positive quantity, at most 1,000,000, with up to 4 decimals. Returns the normalised string or null. */
export function cleanQuantity(raw: string | string[] | undefined | null): string | null {
  if (typeof raw !== "string" || !/^\d{1,7}(\.\d{1,4})?$/.test(raw)) return null;
  const n = Number(raw);
  if (!(n > 0) || n > 1_000_000) return null;
  return String(n);
}

/** A percentage for the markup tool: 0 to 1000 for markup, 0 to 95 for margin. */
export function cleanPercent(raw: string | string[] | undefined | null, mode: "markup" | "margin"): string | null {
  if (typeof raw !== "string" || !/^\d{1,4}(\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  if (!(n >= 0) || n > (mode === "margin" ? 95 : 1000)) return null;
  return String(n);
}

export { cleanFrom } from "@/lib/analytics/from";

/* ---------------------------------------- Markup math ---------------------------------------- */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Margin % for a markup %. */
export const marginFromMarkup = (markup: number): number => round2((markup / (100 + markup)) * 100);
/** Markup % for a margin % (below 100). */
export const markupFromMargin = (margin: number): number => (margin >= 100 ? Infinity : round2((margin / (100 - margin)) * 100));

/** Price and profit from a cost and a markup or margin percentage. */
export function priceFrom(cost: number, mode: "markup" | "margin", pct: number): { price: number; profit: number; markup: number; margin: number } | null {
  if (!(cost >= 0) || !(pct >= 0)) return null;
  if (mode === "margin" && pct >= 100) return null;
  const price = mode === "markup" ? cost * (1 + pct / 100) : cost / (1 - pct / 100);
  return {
    price: round2(price),
    profit: round2(price - cost),
    markup: mode === "markup" ? pct : markupFromMargin(pct),
    margin: mode === "margin" ? pct : marginFromMarkup(pct),
  };
}
