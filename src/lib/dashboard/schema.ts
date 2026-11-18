/**
 * Versioned dashboard layout (stored per person per mode in public.dashboard_layouts). Pure and client-safe.
 *
 * A layout is an ordered list of widget instances. The grid places them in order on a 4-column desktop grid
 * (2 on tablet, 1 on phones), so widgets can never overlap and a phone visit never changes desktop sizes:
 * width and height are stored once, and smaller screens clamp them while drawing.
 *
 * Version history:
 *   1 - { id, type, w (1-4 columns), h (1-2 rows), settings }.
 * When a later version changes the shape, add a step to `migrate` instead of breaking older saved layouts.
 */
import { sanitizeSettings, widgetDef, type Height, type Width, defaultSettings } from "./registry";

export const LAYOUT_VERSION = 1;
export const MAX_WIDGETS = 40;
export const MODES = ["contractor", "accountant"] as const;
export type DashboardMode = (typeof MODES)[number];

export interface WidgetInstance { id: string; type: string; w: Width; h: Height; settings: Record<string, unknown> }
export interface Layout { version: number; template: string | null; widgets: WidgetInstance[] }

const ID = /^[A-Za-z0-9_-]{1,40}$/, TYPE = /^[a-z0-9_]{1,40}$/;
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);

/** Bring an older stored layout up to the current version (no-op today; the hook for future changes). */
function migrate(widgets: unknown[], from: number): unknown[] {
  void from;
  return widgets;
}

/**
 * Read a stored layout, tolerating anything: malformed entries are dropped, sizes clamped to what the widget
 * allows, settings cleaned. Widgets this version doesn't know (removed, or from a newer release) are KEPT as-is,
 * so a newer client's layout survives an older one, and the grid just skips them (customize mode lists them).
 */
export function parseLayout(raw: { widgets?: unknown; template?: unknown; schemaVersion?: unknown } | null | undefined): Layout {
  const version = typeof raw?.schemaVersion === "number" ? raw.schemaVersion : LAYOUT_VERSION;
  const list = Array.isArray(raw?.widgets) ? migrate(raw.widgets, version) : [];
  const seen = new Set<string>();
  const widgets: WidgetInstance[] = [];
  for (const w of list) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (typeof o.id !== "string" || !ID.test(o.id) || seen.has(o.id) || typeof o.type !== "string" || !TYPE.test(o.type)) continue;
    seen.add(o.id);
    const def = widgetDef(o.type);
    if (!def) {
      widgets.push({ id: o.id, type: o.type, w: clamp(o.w, 1, 4, 1) as Width, h: clamp(o.h, 1, 2, 1) as Height, settings: o.settings && typeof o.settings === "object" ? (o.settings as Record<string, unknown>) : {} });
      continue;
    }
    widgets.push({ id: o.id, type: o.type, ...fitSize(def.type, clamp(o.w, 1, 4, def.size.w), clamp(o.h, 1, 2, def.size.h)), settings: sanitizeSettings(def, o.settings) });
    if (widgets.length >= MAX_WIDGETS) break;
  }
  return { version: LAYOUT_VERSION, template: typeof raw?.template === "string" && /^[a-z0-9_]{1,40}$/.test(raw.template) ? raw.template : null, widgets };
}

/** Clamp a size to the widget's limits. */
export function fitSize(type: string, w: number, h: number): { w: Width; h: Height } {
  const def = widgetDef(type);
  const minW = def?.size.minW ?? 1, maxW = def?.size.maxW ?? 4, maxH = def?.size.maxH ?? def?.size.h ?? 2;
  return { w: Math.min(maxW, Math.max(minW, w)) as Width, h: Math.min(maxH, Math.max(1, h)) as Height };
}

/** A new widget instance with the widget's default size and settings. */
export function newInstance(type: string, settings?: Record<string, unknown>, size?: { w?: number; h?: number }, id?: string): WidgetInstance {
  const def = widgetDef(type);
  if (!def) throw new Error(`unknown widget ${type}`);
  return { id: id ?? newId(), type, ...fitSize(type, size?.w ?? def.size.w, size?.h ?? def.size.h), settings: settings ? sanitizeSettings(def, settings) : defaultSettings(def) };
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

// ---- Edits (pure; the editor and the tests use the same functions) -----------------------------------------------
export function move(widgets: WidgetInstance[], id: string, to: number): WidgetInstance[] {
  const from = widgets.findIndex((w) => w.id === id);
  if (from < 0) return widgets;
  const target = Math.max(0, Math.min(widgets.length - 1, to));
  if (target === from) return widgets;
  const next = [...widgets];
  const [it] = next.splice(from, 1);
  next.splice(target, 0, it);
  return next;
}

export const remove = (widgets: WidgetInstance[], id: string) => widgets.filter((w) => w.id !== id);

export function resize(widgets: WidgetInstance[], id: string, w: number, h: number): WidgetInstance[] {
  return widgets.map((x) => (x.id === id ? { ...x, ...fitSize(x.type, w, h) } : x));
}

export function configure(widgets: WidgetInstance[], id: string, settings: Record<string, unknown>): WidgetInstance[] {
  return widgets.map((x) => {
    if (x.id !== id) return x;
    const def = widgetDef(x.type);
    return def ? { ...x, settings: sanitizeSettings(def, { ...x.settings, ...settings }) } : x;
  });
}

export function add(widgets: WidgetInstance[], inst: WidgetInstance, at?: number): WidgetInstance[] {
  if (widgets.length >= MAX_WIDGETS) return widgets;
  const def = widgetDef(inst.type);
  if (def && !def.multiple && widgets.some((w) => w.type === inst.type)) return widgets;
  const next = [...widgets];
  next.splice(at ?? next.length, 0, inst);
  return next;
}

/** What gets stored (no derived fields). */
export const serialize = (l: Layout) => ({ schemaVersion: LAYOUT_VERSION, template: l.template, widgets: l.widgets.map(({ id, type, w, h, settings }) => ({ id, type, w, h, settings })) });
