/**
 * Supplier price-list import (V5 Pricing Intelligence). Pure helpers shared by the import page and
 * tests: parse a CSV (Excel files are read to the same rows in the browser), guess which column is
 * which, normalize units, match rows to the contractor's Saved Items and classify every row before
 * anything is written. Nothing here talks to a supplier or the database.
 */
import { D, toDec } from "../estimate/money";
import { normalizeItemKey, normalizeUnit } from "./provider";

export type ImportField = "name" | "sku" | "unit" | "unitCost" | "packSize" | "category";
export type Mapping = Record<ImportField, number | null>;

export const FIELD_LABELS: Record<ImportField, string> = {
  name: "Product name",
  sku: "Supplier SKU / item #",
  unit: "Unit",
  unitCost: "Price",
  packSize: "Pack size (units per price)",
  category: "Category",
};
export const REQUIRED_FIELDS: ImportField[] = ["name", "unitCost"];

/** Rows above this % change are flagged and left unticked until the contractor reviews them. */
export const BIG_CHANGE_PCT = 25;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** A cell that a spreadsheet would treat as a formula. Never evaluated; the row is refused instead. */
export const looksLikeFormula = (v: string) => /^[=+@\t\r]/.test(v) || /^-[^\d.\s]/.test(v);

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF/LF, a leading BOM; ; or tab when there's no comma. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes(",") ? "," : firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ""));
}

/** Spreadsheet cells (numbers, dates, booleans, null) to the same string rows parseCsv returns. */
export function sheetToRows(data: unknown[][]): string[][] {
  return data
    .map((r) => r.map((v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim())))
    .filter((r) => r.some((v) => v !== ""));
}

const SYNONYMS: Record<ImportField, RegExp> = {
  sku: /^(sku|item ?(#|no\.?|number|code)|product ?(#|code|id)|part ?(#|no\.?|number)|catalog ?(#|no\.?)|mfr ?(#|part))$/,
  name: /^(name|description|item|product|product ?name|item ?description|item ?name|desc)$/,
  unit: /^(unit|uom|u\/m|unit of measure|units?|sell ?unit)$/,
  unitCost: /^(price|cost|unit ?(price|cost)|net ?(price|cost)|your ?(price|cost)|each|amount|sell ?price)$/,
  packSize: /^(pack|pack ?size|pack ?qty|qty ?per|per ?pack|case ?qty|units? ?per ?(pack|case|box)|pkg ?qty)$/,
  category: /^(category|group|class|department|dept)$/,
};

/** Best guess at which column holds which field, from the header row. Unknown columns stay unmapped. */
export function autoMap(headers: string[]): Mapping {
  const m: Mapping = { name: null, sku: null, unit: null, unitCost: null, packSize: null, category: null };
  const norm = headers.map((h) => h.toLowerCase().replace(/[_]/g, " ").replace(/\s+/g, " ").trim());
  for (const f of Object.keys(SYNONYMS) as ImportField[]) {
    const i = norm.findIndex((h, k) => SYNONYMS[f].test(h) && !Object.values(m).includes(k));
    if (i >= 0) m[f] = i;
  }
  return m;
}

/** "$1,234.50" → "1234.50". Negative, blank or non-numeric → null (the row is invalid). */
export function parsePrice(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const s = raw.replace(/[$,\s]/g, "").replace(/^USD/i, "");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  return new D(s).toDecimalPlaces(4).toString();
}

export interface LibraryItemRef {
  id: string;
  name: string;
  unit: string;
  unitCost: string;
  supplierSku?: string | null;
}

export type RowStatus = "new" | "changed" | "unchanged" | "invalid" | "duplicate";

export interface PreviewRow {
  line: number; // 1-based line in the file (header = 1)
  name: string;
  sku: string;
  unit: string; // normalized
  packSize: string; // "" = none
  /** Price per pack as written in the file. */
  filePrice: string;
  /** Price that will be saved: per unit when "price is per pack" is on and a pack size exists. */
  unitCost: string;
  category: string;
  status: RowStatus;
  match?: { id: string; name: string; unitCost: string; unit: string; by: "sku" | "name" };
  /** Percent change from the saved price (changed rows only). */
  changePct?: string;
  bigChange?: boolean;
  unitMismatch?: boolean;
  error?: string;
  /** Ticked by default: new and changed rows that need no review. */
  include: boolean;
}

export interface PreviewSummary {
  rows: PreviewRow[];
  counts: Record<RowStatus, number>;
  flagged: number;
}

export function buildPreview(input: {
  rows: string[][]; // header first
  mapping: Mapping;
  items: LibraryItemRef[];
  /** File prices are per pack: divide by the pack size to save a per-unit price. */
  perUnit?: boolean;
}): PreviewSummary {
  const { mapping: m, items } = input;
  const bySku = new Map<string, LibraryItemRef>();
  const byName = new Map<string, LibraryItemRef>();
  for (const it of items) {
    if (it.supplierSku) bySku.set(it.supplierSku.trim().toLowerCase(), it);
    const k = normalizeItemKey(it.name);
    if (!byName.has(k)) byName.set(k, it);
  }
  const cell = (r: string[], f: ImportField) => (m[f] === null ? "" : (r[m[f] as number] ?? "").trim());
  const seen = new Set<string>();
  const out: PreviewRow[] = input.rows.slice(1, MAX_IMPORT_ROWS + 1).map((r, k) => {
    const name = cell(r, "name").slice(0, 300);
    const sku = cell(r, "sku").slice(0, 80);
    const unit = normalizeUnit(cell(r, "unit") || "each").slice(0, 40);
    const packRaw = cell(r, "packSize");
    const pack = packRaw ? parsePrice(packRaw) : null;
    const filePrice = parsePrice(cell(r, "unitCost"));
    const base = { line: k + 2, name, sku, unit, packSize: pack && new D(pack).gt(0) ? pack : "", filePrice: filePrice ?? cell(r, "unitCost"), category: cell(r, "category").slice(0, 120) };
    if (!name) return { ...base, unitCost: "", status: "invalid" as const, error: "No product name", include: false };
    if ([name, sku, base.category].some(looksLikeFormula)) return { ...base, unitCost: "", status: "invalid" as const, error: "Looks like a spreadsheet formula", include: false };
    if (filePrice === null) return { ...base, unitCost: "", status: "invalid" as const, error: "Price isn't a number", include: false };
    if (packRaw && !base.packSize) return { ...base, unitCost: "", status: "invalid" as const, error: "Pack size isn't a number", include: false };
    const unitCost = input.perUnit && base.packSize ? new D(filePrice).div(base.packSize).toDecimalPlaces(4).toString() : filePrice;
    const key = sku ? `sku:${sku.toLowerCase()}` : `name:${normalizeItemKey(name)}`;
    if (seen.has(key)) return { ...base, unitCost, status: "duplicate" as const, error: "Same item appears earlier in the file", include: false };
    seen.add(key);
    const skuHit = sku ? bySku.get(sku.toLowerCase()) : undefined;
    const hit = skuHit ?? byName.get(normalizeItemKey(name));
    if (!hit) return { ...base, unitCost, status: "new" as const, include: true };
    const match = { id: hit.id, name: hit.name, unitCost: hit.unitCost, unit: hit.unit, by: skuHit ? ("sku" as const) : ("name" as const) };
    const unitMismatch = normalizeUnit(hit.unit) !== unit;
    const prev = toDec(hit.unitCost);
    const same = prev.valid && hit.unitCost !== "" && prev.value.eq(unitCost);
    if (same && !unitMismatch) return { ...base, unitCost, status: "unchanged" as const, match, include: false };
    let changePct: string | undefined, bigChange = false;
    if (prev.valid && hit.unitCost !== "" && !prev.value.isZero()) {
      const pct = new D(unitCost).minus(prev.value).div(prev.value).times(100);
      changePct = pct.toDecimalPlaces(1).toString();
      bigChange = pct.abs().gt(BIG_CHANGE_PCT);
    }
    return { ...base, unitCost, status: "changed" as const, match, changePct, bigChange, unitMismatch, include: !bigChange && !unitMismatch };
  });
  const counts: Record<RowStatus, number> = { new: 0, changed: 0, unchanged: 0, invalid: 0, duplicate: 0 };
  for (const r of out) counts[r.status]++;
  return { rows: out, counts, flagged: out.filter((r) => r.bigChange || r.unitMismatch).length };
}

/** Rows to send to price_import_apply: ticked new/changed rows only. */
export function applyRows(rows: PreviewRow[], opts: { trade?: string | null } = {}) {
  return rows
    .filter((r) => r.include && (r.status === "new" || r.status === "changed"))
    .map((r) => ({
      savedItemId: r.status === "changed" ? r.match?.id : undefined,
      name: r.name,
      sku: r.sku || undefined,
      unit: r.unit,
      packSize: r.packSize || undefined,
      unitCost: r.unitCost,
      category: r.category || undefined,
      trade: opts.trade || undefined,
    }));
}
