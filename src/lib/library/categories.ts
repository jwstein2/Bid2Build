/**
 * Saved Item categories: suggestions while typing, and catching near-duplicates so a library doesn't end
 * up with "Labor", "Labour" and "labor" side by side. Pure functions, shared by the form and the library page.
 */

/** Trims and collapses inner whitespace: "  Rough   Framing " → "Rough Framing". */
export const tidyCategory = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

/** Case- and spacing-insensitive identity: "labor " and "Labor" are the same category. */
export const categoryKey = (s?: string | null) => tidyCategory(s).toLowerCase();

/**
 * A looser identity for spotting likely duplicates: ignores punctuation, US/UK spelling (labour, colour)
 * and a plural "s"/"es" (Material vs Materials, Fixture vs Fixtures).
 */
export function categoryFold(s?: string | null): string {
  let k = categoryKey(s).replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  k = k.replace(/our/g, "or");
  if (k.length > 4 && k.endsWith("es") && /(ss|sh|ch|x|z)es$/.test(k)) k = k.slice(0, -2);
  else if (k.length > 3 && k.endsWith("s") && !k.endsWith("ss")) k = k.slice(0, -1);
  return k;
}

/** Edit distance (insert, delete, replace), stopping early once it passes `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** True when two different spellings are probably the same category (typo, plural, UK spelling). */
export function similarCategories(a?: string | null, b?: string | null): boolean {
  const fa = categoryFold(a), fb = categoryFold(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const len = Math.min(fa.length, fb.length);
  // Short words only allow one typo ("Trim" vs "Tile" stay different); longer ones allow two.
  const max = len < 5 ? 0 : len < 9 ? 1 : 2;
  return max > 0 && distance(fa, fb, max) <= max;
}

/** The existing category with the same name ignoring case and spacing, if any. */
export const exactCategory = (input: string, options: string[]) => {
  const k = categoryKey(input);
  return k ? options.find((o) => categoryKey(o) === k) : undefined;
};

/** An existing category the input probably meant ("labour" → "Labor"), when it isn't already an exact match. */
export function closeCategory(input: string, options: string[]): string | undefined {
  if (!categoryKey(input) || exactCategory(input, options)) return undefined;
  return options.find((o) => similarCategories(input, o));
}

/** Use the existing spelling for a case-only difference; otherwise keep what was typed, tidied. */
export const resolveCategory = (input: string, options: string[]) => exactCategory(input, options) ?? tidyCategory(input);

/** Options for the dropdown: names containing the text first (starts-with leading), then likely matches. */
export function filterCategories(input: string, options: string[]): string[] {
  const k = categoryKey(input);
  if (!k) return options;
  const starts = options.filter((o) => categoryKey(o).startsWith(k));
  const contains = options.filter((o) => !starts.includes(o) && categoryKey(o).includes(k));
  const close = options.filter((o) => !starts.includes(o) && !contains.includes(o) && similarCategories(input, o));
  return [...starts, ...contains, ...close];
}

export interface CategoryDupGroup {
  trade: string | null;
  /** The Type these spellings sit under ("" when the items carry none). */
  costType: string;
  /** Spellings in this group, most-used first, with how many items use each. */
  names: { name: string; count: number }[];
  /** The spelling to merge into: the most used one (ties go to the one starting with a capital). */
  target: string;
}

/**
 * Near-duplicate category spellings within each trade and Type (e.g. Roofing › Labor has "Contractor" ×3,
 * "contractor" ×1, "Contracter" ×1). The same name under another trade or Type is not a duplicate.
 */
export function categoryDuplicates(items: { trade?: string | null; category?: string | null; costType?: string }[], rootLabel: (costType: string) => string = (c) => c): CategoryDupGroup[] {
  const byTrade = new Map<string, Map<string, number>>();
  for (const i of items) {
    const name = i.costType ? childCategory(i.category, rootLabel(i.costType)) : tidyCategory(i.category);
    if (!name) continue;
    const t = `${i.trade ?? ""}\u0000${i.costType ?? ""}`;
    const counts = byTrade.get(t) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    byTrade.set(t, counts);
  }
  const rank = (a: { name: string; count: number }, b: { name: string; count: number }) =>
    b.count - a.count || Number(/^[A-Z]/.test(b.name)) - Number(/^[A-Z]/.test(a.name)) || a.name.localeCompare(b.name);
  const out: CategoryDupGroup[] = [];
  for (const [t, counts] of byTrade) {
    const names = [...counts.entries()].map(([name, count]) => ({ name, count })).sort(rank);
    const used = new Set<string>();
    for (const n of names) {
      if (used.has(n.name)) continue;
      const group = names.filter((m) => !used.has(m.name) && (m.name === n.name || similarCategories(m.name, n.name)));
      group.forEach((m) => used.add(m.name));
      const [trade, costType] = t.split("\u0000");
      if (group.length > 1) out.push({ trade: trade || null, costType, names: group, target: group[0].name });
    }
  }
  return out;
}

/* ── One combined list: Type is the top level, categories nest under it ("Labor : Contractor"). ── */

/** Separator between levels, as shown and as typed ("Labor : Contractor : Framing"). */
export const PATH_SEP = " : ";

/** Splits "Labor:Contractor : Framing" into tidy levels, dropping empties. */
export const pathParts = (s?: string | null) => (s ?? "").split(":").map(tidyCategory).filter(Boolean);

/** The top level of an item's category is its Type. Matches a typed root by label, value or a close spelling ("Labour", "Materials"). */
export function matchRoot<T extends string>(input: string, roots: { value: T; label: string }[]): T | undefined {
  const k = categoryKey(input);
  if (!k) return undefined;
  return (roots.find((r) => categoryKey(r.label) === k || r.value === k.replace(/[\s/]+/g, "_"))
    ?? roots.find((r) => similarCategories(r.label, input)))?.value;
}

/** The item's category below its Type. A category that just repeats the Type ("Labor" on a labor item) counts as none. */
export function childCategory(category: string | null | undefined, rootLabel: string): string {
  const parts = pathParts(category);
  if (parts.length && similarCategories(parts[0], rootLabel)) parts.shift();
  return parts.join(PATH_SEP);
}

/** "Labor : Contractor" for a labor item in category Contractor; just "Labor" with no category. */
export function categoryPath(rootLabel: string, category?: string | null): string {
  const child = childCategory(category, rootLabel);
  return child ? `${rootLabel}${PATH_SEP}${child}` : rootLabel;
}

/**
 * Reads what was typed into the combined list. "Material : Shingles" → Material, "Shingles". Text that doesn't
 * start with a Type stays under `fallback` (the Type picked so far), so "Contractor" → fallback, "Contractor".
 */
export function parseCategoryPath<T extends string>(input: string, roots: { value: T; label: string }[], fallback: T): { type: T; category: string; rootTyped: boolean } {
  const parts = pathParts(input);
  if (!parts.length) return { type: fallback, category: "", rootTyped: false };
  const root = matchRoot(parts[0], roots);
  if (root) return { type: root, category: parts.slice(1).join(PATH_SEP), rootTyped: true };
  return { type: fallback, category: parts.join(PATH_SEP), rootTyped: false };
}
