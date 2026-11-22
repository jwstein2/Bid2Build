/**
 * Example searches under the search box. Each one is shown only where the library can actually answer it:
 * "federal" examples are answered by verified federal text everywhere; "state_text" examples need verified state
 * code text for the chosen state (today Minnesota's amendments). Trade-specific ones come first.
 */
export interface Example { q: string; needs: "federal" | "state_text"; trades?: string[] }

export const EXAMPLES: Example[] = [
  { q: "deck stair riser height", needs: "state_text", trades: ["decks", "finish-carpentry", "framing", "additions", "general-contracting", "handyman"] },
  { q: "guard height", needs: "state_text", trades: ["decks", "finish-carpentry", "framing", "general-contracting", "interior-remodeling"] },
  { q: "footing frost depth", needs: "state_text", trades: ["concrete", "foundations", "decks", "additions", "pole-barns", "garages"] },
  { q: "roof underlayment", needs: "state_text", trades: ["roofing"] },
  { q: "fall protection 6 feet", needs: "federal", trades: ["roofing", "framing", "siding", "general-contracting", "gutters", "windows-doors"] },
  { q: "ladder extend 3 feet", needs: "federal", trades: ["painting", "electrical", "gutters", "siding", "handyman"] },
  { q: "ground-fault circuit interrupter", needs: "federal", trades: ["electrical", "general-contracting"] },
  { q: "trench protective system", needs: "federal", trades: ["excavation", "plumbing", "concrete", "landscaping", "foundations"] },
  { q: "lead-safe renovation", needs: "federal", trades: ["painting", "windows-doors", "interior-remodeling", "kitchens", "bathrooms", "siding"] },
  { q: "silica dust", needs: "federal", trades: ["concrete", "masonry", "tile", "cabinets-countertops", "demolition"] },
  { q: "deck railing height", needs: "state_text", trades: ["decks", "finish-carpentry", "general-contracting"] },
  { q: "deck footing requirements", needs: "state_text", trades: ["decks", "concrete", "foundations"] },
  { q: "lead paint renovation pre-1978", needs: "federal", trades: ["painting", "windows-doors", "interior-remodeling", "exterior-remodeling", "siding", "handyman"] },
  { q: "OSHA fall protection residential roofing", needs: "federal", trades: ["roofing", "framing", "gutters"] },
  { q: "40 CFR 745.85", needs: "federal" },
  { q: "report a serious injury", needs: "federal" },
  { q: "1926.501", needs: "federal" },
];

export function examplesFor(trade: string | null, hasStateText: boolean, max = 6): string[] {
  const usable = EXAMPLES.filter((e) => e.needs === "federal" || hasStateText);
  const mine = trade ? usable.filter((e) => e.trades?.includes(trade)) : [];
  const rest = usable.filter((e) => !mine.includes(e));
  return [...mine, ...rest].slice(0, max).map((e) => e.q);
}

/** Topic shortcuts offered by the search autocomplete (always shown with whatever the library can answer). */
export const TOPIC_SHORTCUTS: string[] = [...new Set([
  ...EXAMPLES.map((e) => e.q),
  "stair handrail height", "scaffold guardrails", "ladder angle", "trench box",
  "respirator silica", "asbestos", "hours of service", "CDL drug testing", "vehicle annual inspection", "injury recordkeeping",
])];

