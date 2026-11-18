import "server-only";
import { createAdminClient, type createClient } from "@/lib/supabase/server";
import { map1099, type Row1099 } from "@/lib/team/records";
import type { Payer } from "@/lib/team/sub-requests";

type Db = Awaited<ReturnType<typeof createClient>>;
export interface Nec1099Recipient extends Row1099 { businessName: string | null; address: string | null }

/** Subs needing a 1099-NEC in a year, with the W-9 name and address, plus the payer details. */
export async function load1099(db: Db, year: number): Promise<{ payer: Payer | null; rows: Nec1099Recipient[] } | { error: { message?: string; code?: string } }> {
  const { data, error } = await db.rpc("pm_sub_1099_totals", { p_year: year });
  if (error) return { error };
  const rows = map1099(data).rows.filter((r) => r.needs1099);
  const ids = rows.map((r) => r.resourceId).filter((x): x is string => !!x);
  const [{ data: tax }, { data: payer }] = await Promise.all([
    ids.length ? db.from("pm_sub_tax_profiles").select("resource_id, business_name, address").in("resource_id", ids) : Promise.resolve({ data: [] as unknown[] }),
    db.from("pm_payer_profiles").select("legal_name, ein, address, phone").maybeSingle(),
  ]);
  const byId = new Map(((tax ?? []) as { resource_id: string; business_name: string | null; address: string | null }[]).map((t) => [t.resource_id, t]));
  const p = payer as { legal_name: string; ein: string | null; address: string | null; phone: string | null } | null;
  return {
    payer: p ? { legalName: p.legal_name, ein: p.ein, address: p.address, phone: p.phone } : null,
    rows: rows.map((r) => ({ ...r, businessName: r.resourceId ? byId.get(r.resourceId)?.business_name ?? null : null, address: r.resourceId ? byId.get(r.resourceId)?.address ?? null : null })),
  };
}

/** Sealed full TINs for these subs (service role; call only after pm_sensitive_log approved each one). */
export async function sealedTins(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await createAdminClient().from("pm_sensitive_ids").select("resource_id, sealed").eq("kind", "tin").in("resource_id", ids);
  return new Map(((data ?? []) as { resource_id: string; sealed: string }[]).map((x) => [x.resource_id, x.sealed]));
}
