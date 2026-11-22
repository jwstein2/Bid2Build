/**
 * Citation-aware autocomplete for the code search (pure, client-safe). Digits or "CFR" in the input match federal
 * section numbers ("1926.50" → 29 CFR 1926.500, 1926.501...); words match topic shortcuts first, then section headings.
 */
export interface Suggestion { value: string; label: string; kind: "topic" | "section" }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").replace(/\s+/g, " ").trim();

export function suggest(input: string, topics: string[], sections: [string, string][], max = 7): Suggestion[] {
  const q = norm(input);
  if (q.length < 2) return [];
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (s: Suggestion) => { const k = s.value.toLowerCase(); if (!seen.has(k) && k !== q) { seen.add(k); out.push(s); } };
  const num = (q.match(/cfr\s*(?:part\s*)?(\d{1,4}(?:\.\d{0,5})?)/) ?? q.match(/(\d{1,4}(?:\.\d{0,5})?)/))?.[1];
  const citationLike = !!num && (/^\d/.test(q) || /\bcfr\b/.test(q) || /^§/.test(input.trim()));
  if (citationLike && num) {
    const title = q.match(/^(\d{1,2})\s*cfr/)?.[1];
    for (const [c, h] of sections) {
      const sec = c.split(" CFR ")[1];
      if ((sec.startsWith(num) || (!title && c.toLowerCase().replace(" cfr ", " ").startsWith(q))) && (!title || c.startsWith(`${title} CFR`))) add({ value: c, label: `${c}: ${h}`, kind: "section" });
      if (out.length >= max) break;
    }
    return out;
  }
  const words = q.split(" ").filter((w) => w.length >= 2);
  const hasAll = (t: string) => { const n = norm(t); return words.every((w) => n.split(" ").some((x) => x.startsWith(w))); };
  for (const t of topics) if (hasAll(t)) add({ value: t, label: t, kind: "topic" });
  for (const [c, h] of sections) { if (out.length >= max) break; if (hasAll(h)) add({ value: c, label: `${c}: ${h}`, kind: "section" }); }
  return out.slice(0, max);
}
