/**
 * Conversion copy for the priority trade landing pages (/bids/<trade>). Layered on top of the trade
 * catalog (src/lib/trades/data.ts) so existing routes, titles, canonical URLs and FAQ content stay as
 * they are. Every claim here must describe a feature that ships today:
 *  - calculator text matches src/lib/calculators/mapping.ts (which calculators an item actually gets),
 *  - no speed, profit or conversion promises, no testimonials.
 * Trades without an entry keep the original page unchanged.
 */
export interface TradeLanding {
  headline: string;
  sub: string;
  cta: string;
  /** Pain points in the contractor's words. */
  pains: [string, string, string];
  /** How the quantity calculators help for this trade (verified against the calculator mapping). */
  calculator: string;
  calculatorBullets: string[];
  /** Title used for the sample proposal image. */
  sampleTitle: string;
}

export const LANDING_TRADES = ["decks", "general-contracting", "painting", "roofing", "concrete", "kitchens", "bathrooms", "flooring", "electrical", "siding", "drywall"] as const;
export type LandingTrade = (typeof LANDING_TRADES)[number];

const LANDING: Record<LandingTrade, TradeLanding> = {
  decks: {
    headline: "Stop Spending Your Nights Writing Deck Estimates.",
    sub: "Build professional deck estimates, organize material and labor costs, and send proposals that make your business look as professional as your work.",
    cta: "Create Your First Free Deck Bid",
    pains: [
      "Pricing footings, framing, boards, stairs and railings on a notepad, then retyping it all.",
      "Homeowners asking for composite and pressure-treated versions of the same deck.",
      "Wondering if your markup actually covers the margin you meant to make.",
    ],
    calculator: "Line items get the calculator that fits them. Enter the deck size and board length, and the board count goes on the line. Stair and railing items get their own.",
    calculatorBullets: ["Decking boards from deck area and board length", "Stair treads, risers and stringers from rise and run", "Railing sections and fascia boards from linear footage"],
    sampleTitle: "Composite Deck with Aluminum Railings",
  },
  "general-contracting": {
    headline: "Professional Remodeling Bids Without the Spreadsheet Mess.",
    sub: "Organize every trade, material and labor cost in one estimate, and give your customer a clean proposal that shows only what you want them to see.",
    cta: "Create a Free Remodeling Bid",
    pains: [
      "Subs, materials, permits and your own labor scattered across files and texts.",
      "Customers who want to see the price of each phase, or only the total.",
      "Rebuilding the same proposal layout for every job.",
    ],
    calculator: "Area, linear footage, volume and labor-hour calculators sit right on the line item, so measurements turn into quantities without a separate calculator app.",
    calculatorBullets: ["Area with rectangles, triangles and circles", "Concrete and excavation volume in cubic yards", "Labor hours from a production rate", "Unit conversion (SF, SY, squares, LF)"],
    sampleTitle: "Basement Finish and Bath Addition",
  },
  painting: {
    headline: "More Professional Painting Estimates. Less Paperwork.",
    sub: "Measure walls, work out gallons and labor, and send a clear, branded painting proposal your customer can sign online.",
    cta: "Create a Free Painting Estimate",
    pains: [
      "Adding up wall areas, gables and openings by hand for every room.",
      "Turning square footage into gallons of primer and paint.",
      "Proposals that look homemade next to bigger competitors.",
    ],
    calculator: "Paint lines get a wall-area calculator: walls (length × height), gables, and window or door openings deducted. Paint and primer by the gallon use coverage per gallon.",
    calculatorBullets: ["Wall area with gables and openings deducted", "Gallons from coverage per gallon and coats", "Labor hours from your production rate"],
    sampleTitle: "Interior Repaint: Main Floor",
  },
  roofing: {
    headline: "Roofing Estimates That Measure Up.",
    sub: "Turn roof planes and pitch into squares, list every material and labor item, and send a professional roofing proposal.",
    cta: "Create a Free Roofing Bid",
    pains: [
      "Converting pitch and plane measurements into squares by hand.",
      "Forgetting ridge cap, drip edge or starter on a rushed bid.",
      "Customers comparing your scribbled quote with a polished one.",
    ],
    calculator: "Roofing lines get a roof-plane calculator with pitch (including triangular hip faces). Ridge, hip, valley and edge items get linear footage, and starter strip uses the building perimeter.",
    calculatorBullets: ["Roof area in squares from planes and pitch", "Ridge, hip, valley, eave and rake lengths", "Shingle bundles from coverage"],
    sampleTitle: "Full Tear-Off and Architectural Shingle Re-Roof",
  },
  concrete: {
    headline: "Concrete Bids Built Around Yards, Forms and Finish.",
    sub: "Calculate cubic yards for slabs, footings and piers, price forms and finishing, and send the customer one clear total.",
    cta: "Create a Free Concrete Bid",
    pains: [
      "Converting length, width and inches of thickness into cubic yards.",
      "Pump, short-load and delivery fees getting lost.",
      "Explaining a flatwork price without showing your costs.",
    ],
    calculator: "Cubic-yard lines get a volume calculator with slab, continuous footing, round pier and excavation shapes. Form boards and expansion joint use the perimeter calculator.",
    calculatorBullets: ["Slab, footing and pier volume in cubic yards", "Excavation volume", "Form boards from perimeter", "Unit conversion"],
    sampleTitle: "Driveway Replacement",
  },
  kitchens: {
    headline: "Kitchen Remodel Bids Your Customers Can Actually Follow.",
    sub: "Organize cabinets, countertops, trades and allowances in one estimate, then choose how much detail the homeowner sees.",
    cta: "Create a Free Kitchen Remodel Bid",
    pains: [
      "Homeowners asking for budget, mid-range and premium versions.",
      "Cabinets, tops, tile, plumbing and electrical all on different quotes.",
      "Allowances and exclusions that get forgotten until it's too late.",
    ],
    calculator: "Countertop and backsplash lines get area calculators, cabinets and countertops priced per foot get linear footage, and flooring gets floor area.",
    calculatorBullets: ["Countertop area", "Backsplash area (length × height)", "Cabinet linear footage", "Floor area"],
    sampleTitle: "Kitchen Remodel: Cabinets, Quartz and Tile",
  },
  bathrooms: {
    headline: "Bathroom Remodel Estimates Without the Guesswork.",
    sub: "Price demo, waterproofing, tile, fixtures and labor in one place, and send a proposal that shows what's included.",
    cta: "Create a Free Bathroom Bid",
    pains: [
      "Measuring shower walls around niches and windows.",
      "Working out boxes of tile, thinset and grout.",
      "Customers changing their mind on tile, vanity and fixtures.",
    ],
    calculator: "Shower and wall-tile lines get a wall-area calculator with openings deducted, floor tile gets floor area, and tile, thinset and grout by the box or bag use coverage.",
    calculatorBullets: ["Shower wall area with openings deducted", "Floor area", "Tile and setting-material coverage"],
    sampleTitle: "Primary Bath Remodel with Tile Shower",
  },
  flooring: {
    headline: "Flooring Estimates From Square Feet to Signed Proposal.",
    sub: "Measure rooms, add waste, convert square feet and yards, and give your customer a clean flooring proposal.",
    cta: "Create a Free Flooring Estimate",
    pains: [
      "Adding up odd-shaped rooms and closets by hand.",
      "Quoting tile, carpet and LVP options for the same rooms.",
      "Forgetting transitions, baseboard or furniture moving.",
    ],
    calculator: "Floor lines get an area calculator with rectangles, triangles and circles. Baseboard and transitions use perimeter, and boxes or rolls use coverage.",
    calculatorBullets: ["Floor area from room shapes", "Baseboard from perimeter", "Boxes or rolls from coverage", "Square feet ↔ square yards"],
    sampleTitle: "LVP Flooring: Main Level",
  },
  electrical: {
    headline: "Electrical Estimates That Look as Sharp as Your Work.",
    sub: "List devices, fixtures, materials and labor, set your markup or margin, and send a branded electrical proposal.",
    cta: "Create a Free Electrical Bid",
    pains: [
      "Counting devices and fixtures across messy notes.",
      "Labor hours that never quite match the job.",
      "Proposals that show either too much or too little.",
    ],
    calculator: "Electrical work is mostly priced by the device, fixture and hour. Hourly lines get a labor calculator (count × production rate), and wire or conduit by the foot gets linear footage.",
    calculatorBullets: ["Labor hours from a production rate", "Wire and conduit linear footage"],
    sampleTitle: "Panel Upgrade and Kitchen Circuits",
  },
  siding: {
    headline: "Siding Bids Without the Wall-by-Wall Math.",
    sub: "Measure walls and gables, deduct openings, and price trim and accessories in a proposal your customer understands.",
    cta: "Create a Free Siding Bid",
    pains: [
      "Wall-by-wall measurements with gables and openings to subtract.",
      "J-channel, corners and starter that are easy to forget.",
      "Homeowners comparing your bid line by line.",
    ],
    calculator: "Siding lines get a wall-area calculator with gables and openings deducted. J-channel and window trim are measured around openings, and starter strip from the perimeter.",
    calculatorBullets: ["Wall area in squares, openings deducted", "J-channel and trim around openings", "Corner lengths", "Starter strip from perimeter"],
    sampleTitle: "Vinyl Siding Replacement",
  },
  drywall: {
    headline: "Drywall Estimates From Wall Area to Final Price.",
    sub: "Measure walls and ceilings, work out sheets and materials, and send a professional drywall proposal.",
    cta: "Create a Free Drywall Bid",
    pains: [
      "Measuring every wall and ceiling and subtracting openings.",
      "Turning area into sheets, mud and tape.",
      "Pricing hang, tape and finish levels clearly.",
    ],
    calculator: "Drywall lines get a wall-area calculator with openings deducted, and sheets, buckets or boxes use coverage per unit.",
    calculatorBullets: ["Wall and ceiling area, openings deducted", "Sheets and materials from coverage", "Labor hours from your production rate"],
    sampleTitle: "Basement Drywall: Hang, Tape and Finish",
  },
};

export function landingFor(slug: string): TradeLanding | null {
  return (LANDING as Record<string, TradeLanding>)[slug] ?? null;
}

/** The four customer-facing pricing presentations the proposal step offers (verified in proposal settings). */
export const PRICE_DISPLAYS = [
  { title: "Fully itemized", body: "Every line with its price, for customers who want the detail." },
  { title: "Item names, no prices", body: "List what's included under each section total." },
  { title: "Section totals only", body: "One price per section, like Framing or Decking." },
  { title: "Project total only", body: "A single price with your scope of work." },
];
