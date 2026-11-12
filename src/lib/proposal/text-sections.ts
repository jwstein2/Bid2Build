/**
 * Scope of Work and Exclusions & Clarifications: data model, normalization and the
 * cost-free "generation input" sent to the generator. Shared by the browser and the server.
 *
 * Storage: these live inside the estimate's proposal_config (already saved by save_estimate and
 * frozen into every finalized version's snapshot), so a finalized PDF always keeps the exact
 * scope and exclusions that were approved when it was exported.
 */
import type { Estimate } from "../estimate/types";
import { tradeName } from "../trades/catalog";

export type WritingStyle = "simple" | "professional" | "detailed";
export const WRITING_STYLES: { id: WritingStyle; label: string; hint: string }[] = [
  { id: "simple", label: "Simple", hint: "Short, plain, customer-friendly." },
  { id: "professional", label: "Professional", hint: "Polished proposal language." },
  { id: "detailed", label: "Detailed", hint: "Organized by work category." },
];

/** manual = typed by the contractor; generated = untouched generator output; edited = generated then changed. */
export type TextSource = "manual" | "generated" | "edited";

export interface TextRevision {
  at: string;
  content: string;
  source: TextSource;
}

export interface ScopeSettings {
  visible: boolean;
  source: TextSource;
  style: WritingStyle;
  generatedAt: string | null;
  /** e.g. "ai:claude-opus-5-5:scope-v1" or "rules:scope-v1" */
  generator: string | null;
  /** Bid fingerprint the generated text was based on (see bidFingerprint). */
  basedOn: string | null;
  updatedAt: string | null;
  history: TextRevision[];
}

export type ExclusionStatus = "approved" | "suggested" | "rejected";

export interface ExclusionItem {
  id: string;
  /** Standard category key (permits, electrical, ...) or "custom". Used for analytics; never the text. */
  category: string;
  title: string;
  text: string;
  status: ExclusionStatus;
  source: TextSource;
  /** Set when the generator wants the contractor to double-check this one. */
  review?: string | null;
}

export interface ExclusionRevision {
  at: string;
  items: ExclusionItem[];
}

export interface ExclusionSettings {
  visible: boolean;
  style: WritingStyle;
  generatedAt: string | null;
  generator: string | null;
  basedOn: string | null;
  updatedAt: string | null;
  items: ExclusionItem[];
  history: ExclusionRevision[];
}

export const HISTORY_LIMIT = 10;
export const SCOPE_MAX = 20000;
export const EXCLUSION_TEXT_MAX = 1000;
export const EXCLUSIONS_MAX = 40;

export const defaultScopeSettings = (): ScopeSettings => ({
  visible: true,
  source: "manual",
  style: "professional",
  generatedAt: null,
  generator: null,
  basedOn: null,
  updatedAt: null,
  history: [],
});

export const defaultExclusionSettings = (): ExclusionSettings => ({
  visible: true,
  style: "professional",
  generatedAt: null,
  generator: null,
  basedOn: null,
  updatedAt: null,
  items: [],
  history: [],
});

const STYLES = new Set<WritingStyle>(["simple", "professional", "detailed"]);
const SOURCES = new Set<TextSource>(["manual", "generated", "edited"]);
const STATUSES = new Set<ExclusionStatus>(["approved", "suggested", "rejected"]);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const strOrNull = (v: unknown, max = 200) => (typeof v === "string" && v ? v.slice(0, max) : null);

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `x${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function normalizeScope(raw: unknown): ScopeSettings {
  const d = defaultScopeSettings();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  return {
    visible: typeof r.visible === "boolean" ? r.visible : d.visible,
    source: SOURCES.has(r.source as TextSource) ? (r.source as TextSource) : d.source,
    style: STYLES.has(r.style as WritingStyle) ? (r.style as WritingStyle) : d.style,
    generatedAt: strOrNull(r.generatedAt, 40),
    generator: strOrNull(r.generator, 120),
    basedOn: strOrNull(r.basedOn, 64),
    updatedAt: strOrNull(r.updatedAt, 40),
    history: Array.isArray(r.history)
      ? r.history.slice(-HISTORY_LIMIT).map((h) => {
          const x = (h ?? {}) as Record<string, unknown>;
          return { at: str(x.at, 40), content: str(x.content, SCOPE_MAX), source: SOURCES.has(x.source as TextSource) ? (x.source as TextSource) : "manual" };
        })
      : [],
  };
}

function normalizeItem(raw: unknown): ExclusionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = str(r.text, EXCLUSION_TEXT_MAX);
  const title = str(r.title, 120);
  if (!text.trim() && !title.trim()) return null;
  return {
    id: str(r.id, 64) || newId(),
    category: str(r.category, 40) || "custom",
    title,
    text,
    status: STATUSES.has(r.status as ExclusionStatus) ? (r.status as ExclusionStatus) : "approved",
    source: SOURCES.has(r.source as TextSource) ? (r.source as TextSource) : "manual",
    review: strOrNull(r.review, 300),
  };
}

/** Split legacy free-text exclusions into one approved, manual item per paragraph or list line. */
export function legacyExclusionItems(text: string): ExclusionItem[] {
  const t = text.trim();
  if (!t) return [];
  const parts = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split(/\n/);
  return parts
    .map((p) => p.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, EXCLUSIONS_MAX)
    .map((p) => {
      const m = p.match(/^([^:\n]{2,60}):\s+([\s\S]+)$/);
      return { id: newId(), category: "custom", title: m ? m[1].trim() : "", text: m ? m[2].trim() : p, status: "approved" as const, source: "manual" as const, review: null };
    });
}

export function normalizeExclusions(raw: unknown, legacyText = ""): ExclusionSettings {
  const d = defaultExclusionSettings();
  if (!raw || typeof raw !== "object") return { ...d, items: legacyExclusionItems(legacyText) };
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items.map(normalizeItem).filter((x): x is ExclusionItem => Boolean(x)).slice(0, EXCLUSIONS_MAX) : [];
  return {
    visible: typeof r.visible === "boolean" ? r.visible : d.visible,
    style: STYLES.has(r.style as WritingStyle) ? (r.style as WritingStyle) : d.style,
    generatedAt: strOrNull(r.generatedAt, 40),
    generator: strOrNull(r.generator, 120),
    basedOn: strOrNull(r.basedOn, 64),
    updatedAt: strOrNull(r.updatedAt, 40),
    items: items.length ? items : legacyExclusionItems(legacyText),
    history: Array.isArray(r.history)
      ? r.history.slice(-HISTORY_LIMIT).map((h) => {
          const x = (h ?? {}) as Record<string, unknown>;
          return { at: str(x.at, 40), items: Array.isArray(x.items) ? x.items.map(normalizeItem).filter((y): y is ExclusionItem => Boolean(y)) : [] };
        })
      : [],
  };
}

/** Push the current text onto history (skipping empty text and exact repeats). */
export function pushScopeHistory(s: ScopeSettings, content: string, at = new Date().toISOString()): TextRevision[] {
  if (!content.trim()) return s.history;
  const last = s.history[s.history.length - 1];
  if (last && last.content === content) return s.history;
  return [...s.history, { at, content, source: s.source }].slice(-HISTORY_LIMIT);
}

export function pushExclusionHistory(s: ExclusionSettings, at = new Date().toISOString()): ExclusionRevision[] {
  const live = s.items.filter((i) => i.text.trim() || i.title.trim());
  if (!live.length) return s.history;
  const last = s.history[s.history.length - 1];
  if (last && JSON.stringify(last.items) === JSON.stringify(live)) return s.history;
  return [...s.history, { at, items: live }].slice(-HISTORY_LIMIT);
}

/** The text the customer sees for one exclusion. */
export function exclusionLine(i: Pick<ExclusionItem, "title" | "text">): string {
  const title = i.title.trim().replace(/[:.]+$/, "");
  const text = i.text.trim();
  if (title && text) return `${title}: ${text}`;
  return title || text;
}

/** Only contractor-approved, non-empty exclusions ever reach the customer. */
export function approvedExclusions(s: ExclusionSettings): ExclusionItem[] {
  return s.items.filter((i) => i.status === "approved" && exclusionLine(i));
}

export function customerScope(scopeOfWork: string, s: ScopeSettings): string | undefined {
  const t = scopeOfWork.trim();
  return s.visible && t ? t : undefined;
}

export function customerExclusions(s: ExclusionSettings): string | undefined {
  if (!s.visible) return undefined;
  const list = approvedExclusions(s);
  if (!list.length) return undefined;
  return list.map((i, n) => `${n + 1}. ${exclusionLine(i)}`).join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * Bid fingerprint: changes when the work described by the bid changes (names, quantities, units,
 * sections, trades) but not when only prices change, since prices never appear in the scope.
 * --------------------------------------------------------------------------------------------- */
function fnv1a(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return ((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0"));
}

export function bidFingerprint(e: Estimate): string {
  const groups = [...e.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const parts = [
    e.trades.join(","),
    e.title.trim(),
    ...groups.map((g) => {
      const items = e.items
        .filter((i) => i.groupId === g.id && !i.isExample)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => [i.name.trim(), (i.description ?? "").trim(), i.quantity, i.unit, i.costType].join("|"));
      return [g.name.trim(), (g.description ?? "").trim(), ...items].join("\u0001");
    }),
  ];
  return fnv1a(parts.join("\u0002"));
}

/* ------------------------------------------------------------------------------------------------
 * Generation input. This is the ONLY data that leaves the browser for scope/exclusion generation.
 * It deliberately has no unit costs, prices, markup, margin, tax, customer name, email, phone or
 * address. Private notes are included only when the contractor opts in, and are scrubbed.
 * --------------------------------------------------------------------------------------------- */
export interface GenItem {
  name: string;
  description?: string;
  quantity: string;
  unit: string;
  kind: string; // material | labor | equipment | subcontractor | permit | ...
}
export interface GenGroup {
  name: string;
  description?: string;
  items: GenItem[];
}
export interface GenerationInput {
  kind: "scope" | "exclusions";
  style: WritingStyle;
  /** Trade display names (for wording) and slugs (for trade-specific rules). */
  trades: string[];
  tradeSlugs: string[];
  projectTitle: string;
  notes?: string;
  groups: GenGroup[];
  /** Exclusions only: the current Scope of Work text. */
  scope?: string;
  /** Exclusions only: exclusions the contractor already has (so suggestions don't duplicate them). */
  existing?: { category: string; text: string }[];
}

export const INPUT_LIMITS = { groups: 60, itemsPerGroup: 120, name: 200, description: 600, notes: 2000, scope: 8000, existing: 40 };

/** Remove emails, phone numbers and URLs from free text before it can reach a model. */
export function scrubContact(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/https?:\/\/\S+/g, "[link removed]")
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]");
}

const clip = (s: string | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, n) : undefined;
};

export function buildGenerationInput(
  e: Estimate,
  opts: { kind: "scope" | "exclusions"; style: WritingStyle; includeNotes?: boolean; scope?: string; existing?: ExclusionItem[] },
): GenerationInput {
  const groups = [...e.groups]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, INPUT_LIMITS.groups)
    .map((g) => ({
      name: clip(g.name, INPUT_LIMITS.name) ?? "Work",
      description: clip(g.description, INPUT_LIMITS.description),
      items: e.items
        .filter((i) => i.groupId === g.id && !i.isExample && i.name.trim())
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, INPUT_LIMITS.itemsPerGroup)
        .map((i) => ({ name: i.name.trim().slice(0, INPUT_LIMITS.name), description: clip(i.description, INPUT_LIMITS.description), quantity: i.quantity || "", unit: i.unit, kind: i.costType })),
    }))
    .filter((g) => g.items.length > 0);
  const input: GenerationInput = {
    kind: opts.kind,
    style: opts.style,
    trades: e.trades.map(tradeName),
    tradeSlugs: e.trades.slice(0, 20),
    projectTitle: e.title.trim().slice(0, 300),
    groups,
  };
  if (opts.includeNotes && e.customer.notes?.trim()) input.notes = scrubContact(e.customer.notes.trim()).slice(0, INPUT_LIMITS.notes);
  if (opts.kind === "exclusions") {
    if (opts.scope?.trim()) input.scope = opts.scope.trim().slice(0, INPUT_LIMITS.scope);
    input.existing = (opts.existing ?? [])
      .filter((i) => i.status !== "rejected" && exclusionLine(i))
      .slice(0, INPUT_LIMITS.existing)
      .map((i) => ({ category: i.category, text: exclusionLine(i).slice(0, 400) }));
  }
  return input;
}

export const hasBidContent = (input: GenerationInput) => input.groups.some((g) => g.items.length > 0);
