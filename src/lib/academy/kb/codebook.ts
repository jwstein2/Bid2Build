/**
 * Codebook navigation over the official eCFR hierarchy snapshot (scripts/academy/kb/gen_ecfr_structure.py):
 * Title → Chapter → Part → Subpart → Section headings for the contractor-relevant federal parts. Headings only, no
 * regulatory text; text comes from the verified local index (where we have it) or the official eCFR page.
 */
import data from "./seed/ecfr-structure.json";
import { ecfrPartUrl, ecfrSectionUrl } from "./ecfr";

export interface CodebookNode { t: string; id: string; label: string; desc?: string; reserved?: boolean; children?: CodebookNode[] }
export interface CodebookPart { title: number; part: string; why: string; as_of: string; last_amended: string | null; path: { t: string; label: string; desc: string }[]; node: CodebookNode }

export const CODEBOOK = data as unknown as { generated: string; source: string; parts: CodebookPart[] };

export const partKey = (p: Pick<CodebookPart, "title" | "part">) => `${p.title}-${p.part}`;
export const findPart = (key: string | null | undefined) => CODEBOOK.parts.find((p) => partKey(p) === key) ?? null;
export const partUrl = (p: Pick<CodebookPart, "title" | "part">) => ecfrPartUrl(p.title, p.part);
export const sectionUrl = (title: number, id: string) => ecfrSectionUrl(title, id);

/** Every section of a part, in order, with its subpart. */
export function sectionsOf(p: CodebookPart): { id: string; label: string; subpart: string | null }[] {
  const out: { id: string; label: string; subpart: string | null }[] = [];
  const walk = (n: CodebookNode, sub: string | null) => {
    if (n.t === "section") { if (!n.reserved) out.push({ id: n.id, label: n.label.replace(/\.$/, ""), subpart: sub }); return; }
    for (const c of n.children ?? []) walk(c, n.t === "subpart" ? `${n.label}${n.desc ? `: ${n.desc}` : ""}` : sub);
  };
  walk(p.node, null);
  return out;
}

/** Heading of one federal section ("29 CFR 1926.501" → "Duty to have fall protection"), or null if not in the snapshot. */
export function federalHeading(title: number, section: string): { heading: string; part: CodebookPart } | null {
  const part = CODEBOOK.parts.find((p) => p.title === title && section.startsWith(`${p.part}.`));
  if (!part) return null;
  const hit = sectionsOf(part).find((s) => s.id === section);
  return hit ? { heading: hit.label, part } : null;
}

/** Parts whose live latest amendment date is newer than the snapshot (the codebook headings may be out of date). */
export function codebookDrift(live: Record<string, string | null>): { key: string; part: CodebookPart; live: string }[] {
  const out: { key: string; part: CodebookPart; live: string }[] = [];
  for (const p of CODEBOOK.parts) {
    const l = live[partKey(p)];
    if (l && (!p.last_amended || l > p.last_amended)) out.push({ key: partKey(p), part: p, live: l });
  }
  return out;
}
