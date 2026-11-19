/**
 * Weekly automated lead import (Sales Portal Phase 3a). A scheduled Claude agent finds contractor
 * businesses from public sources and posts them here. The format is documented in
 * docs/sales-portal/LEAD_IMPORT.md; keep the two in step.
 */
import { z } from "zod";

const s = (max: number) => z.string().trim().max(max).optional().nullable();

export const ImportLead = z.object({
  company_name: z.string().trim().min(1).max(200),
  contact_name: s(120),
  email: s(320),
  phone: s(40),
  website: s(300),
  city: s(100),
  state: s(40),
  zip: s(10),
  trades: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  /** Public page the business was found on (directory listing, company site). */
  source_url: s(300),
  notes: s(1000),
});

export const ImportBody = z.object({
  /** The run's own id (e.g. "2026-W47"). Re-sending the same id returns the first result. */
  batch_id: z.string().trim().min(1).max(100),
  label: s(200),
  leads: z.array(z.unknown()).max(1000),
});

export type ImportResult = { received: number; added: number; duplicates: number; suppressed: number; invalid: number; replayed: boolean };

/** Keep valid rows, count the rest as invalid (one bad row never fails the whole run). */
export function cleanRows(rows: unknown[]): { valid: z.infer<typeof ImportLead>[]; invalid: number } {
  const valid: z.infer<typeof ImportLead>[] = [];
  let invalid = 0;
  for (const r of rows) {
    const p = ImportLead.safeParse(r);
    if (p.success) valid.push(p.data); else invalid++;
  }
  return { valid, invalid };
}
