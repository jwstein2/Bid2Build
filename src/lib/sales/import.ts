/**
 * Weekly automated lead import (Sales Portal Phase 3a). A scheduled Claude agent finds contractor
 * businesses near the owner's target ZIP and trade and posts them here. The format is documented in
 * docs/sales-portal/LEAD_IMPORT.md; keep the two in step.
 *
 * Only verified leads are accepted: owner name, business email, phone, business name, trade, business
 * start date and ZIP are all required, and the owner name, email and phone must each cite the public
 * page they were checked on. Rows missing any of that are counted as "unverified" and not stored.
 */
import { z } from "zod";

const s = (max: number) => z.string().trim().max(max).optional().nullable();
const sources = z.array(z.string().trim().url().max(300)).min(1).max(5);

export const ImportLead = z.object({
  company_name: z.string().trim().min(1).max(200),
  /** The owner's name, as published on a public record (license board, state business filing, company site). */
  contact_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: z.string().trim().max(40).refine((p) => /^1?\d{10}$/.test(p.replace(/\D/g, "")), "10-digit US phone"),
  website: s(300),
  city: s(100),
  state: s(40),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/),
  trades: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  /** As published on the state filing or license: YYYY, YYYY-MM or YYYY-MM-DD. */
  business_started: z.string().trim().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/),
  /** Public pages each fact was checked on. */
  verification: z.object({
    owner_name: sources,
    email: sources,
    phone: sources,
    business_started: sources.optional(),
  }).passthrough(),
  /** Public page the business was found on (directory listing, company site). */
  source_url: s(300),
  /** Facts for the sales brief (crew size, services, reviews summary). Not shown to the business. */
  notes: s(1000),
});
export type ImportLeadRow = z.infer<typeof ImportLead>;

export const ImportBody = z.object({
  /** The run's own id (e.g. "2026-W47"). Re-sending the same id returns the first result. */
  batch_id: z.string().trim().min(1).max(100),
  label: s(200),
  leads: z.array(z.unknown()).max(1000),
});

export type ImportResult = {
  received: number; added: number; duplicates: number; suppressed: number; invalid: number; unverified: number;
  replayed: boolean; added_ids: string[];
};

/** Keep verified rows; count the rest (one bad row never fails the whole run). */
export function cleanRows(rows: unknown[]): { valid: ImportLeadRow[]; unverified: number; reasons: string[] } {
  const valid: ImportLeadRow[] = [];
  const reasons = new Set<string>();
  let unverified = 0;
  for (const r of rows) {
    const p = ImportLead.safeParse(r);
    if (p.success) valid.push(p.data);
    else { unverified++; for (const i of p.error.issues.slice(0, 3)) reasons.add(i.path.join(".") || "row"); }
  }
  return { valid, unverified, reasons: [...reasons].slice(0, 10) };
}
