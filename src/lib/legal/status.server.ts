import "server-only";
import { cache } from "react";
import { isSupabaseConfigured } from "../env";
import { createClient } from "../supabase/server";
import { LEGAL_DOCUMENTS, effectiveStatus, type LegalStatus, type LegalStatusRecord } from "./registry";

/**
 * Public legal-review statuses (no internal notes), one request per render. Reads the owner's recorded
 * statuses through legal_public_statuses(); if the table isn't there yet (SQL not run) or the read fails,
 * every document falls back to its registry default ("Published, legal review pending"). Never throws:
 * a legal page must always render.
 */
export const getLegalStatuses = cache(async (): Promise<Record<string, LegalStatusRecord>> => {
  const recorded = new Map<string, { status: LegalStatus; review_completed_on: string | null }>();
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await (await createClient()).rpc("legal_public_statuses");
      if (!error && Array.isArray(data)) for (const r of data as { doc_key: string; status: LegalStatus; review_completed_on: string | null }[]) recorded.set(r.doc_key, r);
    } catch {
      // Fall back to registry defaults.
    }
  }
  return Object.fromEntries(LEGAL_DOCUMENTS.map((d) => {
    const r = recorded.get(d.key);
    return [d.key, effectiveStatus(d, r ? { status: r.status, reviewCompletedOn: r.review_completed_on } : null)];
  }));
});

export async function getLegalStatus(key: string): Promise<LegalStatusRecord> {
  return (await getLegalStatuses())[key] ?? { status: "published_pending", reviewCompletedOn: null };
}
