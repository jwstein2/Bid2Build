import { US_STATES } from "@/lib/market/geo";

/**
 * Finding the places an item is about, from its own text. We never guess a location the text doesn't
 * name: "Bay County" in a FEMA declaration is local to Bay County, Florida, not to every Floridian.
 */

const NAMES = Object.entries(US_STATES)
  .filter(([c]) => !["PR", "VI", "GU"].includes(c))
  .map(([code, name]) => ({ code, name, re: new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i") }));

/** State codes named in the text. "Washington, D.C." is DC, not Washington State; "Georgia Tech" still means Georgia. */
export function statesInText(text: string): string[] {
  const t = text.replace(/Washington,?\s+D\.?\s?C\.?/gi, "District of Columbia").replace(/New York City/gi, "New York");
  const found = new Set<string>();
  for (const s of NAMES) {
    if (s.code === "WA" && /\bWashington\b/.test(t) && !/\bWashington\s+(state|State)\b|\bstate of Washington\b|\bWashington's\b|,\s*Washington\b/.test(t)) {
      // Bare "Washington" is usually the federal government; count it only with a state-y cue.
      continue;
    }
    if (s.re.test(t)) found.add(s.code);
  }
  return [...found].sort();
}

export const stateName = (code: string) => US_STATES[code] ?? code;

/** Normalize a county/area name for matching: "Bay (County)" / "Bay County" → "bay". */
export function normPlace(s: string): string {
  return s.toLowerCase().replace(/\((county|parish|borough|city|municipio|census area)\)/g, "").replace(/\b(county|parish|borough|municipio|census area)\b/g, "")
    .replace(/[^a-z0-9\s.'-]/g, " ").replace(/\s+/g, " ").trim();
}

/** Area names listed in a FEMA-style "Designated areas: A, B and 3 more." sentence. */
export function placesFromSummary(text: string): string[] {
  const m = text.match(/Designated areas: ([^.]+?)(?: and \d+ more)?\./);
  return m ? m[1].split(",").map((x) => normPlace(x)).filter(Boolean) : [];
}
