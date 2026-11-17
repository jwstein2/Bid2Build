/** Fixed vocabulary for photo labels (people may also type their own; the database bounds them). */
export const PHOTO_LABELS = [
  "before", "during", "after", "damage", "existing condition", "measurement", "material", "delivery", "inspection",
  "permit", "safety", "punch list", "exterior", "interior", "roof", "siding", "windows", "doors", "kitchen", "bathroom",
  "basement", "foundation", "framing", "electrical", "plumbing", "hvac", "drywall", "paint", "flooring", "concrete",
  "deck", "fence", "landscaping", "gutters", "insulation", "cleanup",
] as const;

export function normalizeLabels(input: unknown, max = 10): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const x of input) {
    if (typeof x !== "string") continue;
    const v = x.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** AI suggestions are limited to the fixed vocabulary so a model can never invent tags. */
export const filterSuggestions = (input: unknown): string[] => normalizeLabels(input).filter((l) => (PHOTO_LABELS as readonly string[]).includes(l)).slice(0, 6);
