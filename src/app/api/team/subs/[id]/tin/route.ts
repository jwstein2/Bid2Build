import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { formatTaxId, normalizeTaxId, openPii, piiReady, sealPii } from "@/lib/security/pii";
import { dbFail, guardRead, guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

/**
 * A subcontractor's full TIN (for 1099-NEC). Encrypted before it's stored; only the owner and people allowed
 * to "Manage subcontractor compliance" can save or reveal it, and every save and reveal is logged first
 * (pm_sensitive_log runs as the signed-in user and refuses anyone else).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  if (!piiReady()) return fail(503, "pii_off", "Full tax IDs turn on once the encryption key is set.");
  const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "tin", p_action: "revealed" });
  if (error) return dbFail("subs.tin.reveal", error);
  const { data } = await createAdminClient().from("pm_sensitive_ids").select("sealed").eq("resource_id", id).eq("kind", "tin").maybeSingle();
  if (!data) return fail(404, "not_found", "No full tax ID on file.");
  const { data: t } = await g.supabase.from("pm_sub_tax_profiles").select("tin_type").eq("resource_id", id).maybeSingle();
  try {
    const digits = openPii(String((data as { sealed: string }).sealed));
    return json({ tin: formatTaxId(digits, (t as { tin_type?: string } | null)?.tin_type === "ssn" ? "ssn" : "ein") }, 200);
  } catch (e) {
    logError("subs.tin.open", e);
    return fail(500, "pii_error", "We couldn't read this tax ID.");
  }
}

const body = z.object({ tin: z.string().max(20), tinType: z.enum(["ssn", "ein"]) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("sub-tin", 30);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  if (!piiReady()) return fail(503, "pii_off", "Full tax IDs turn on once the encryption key is set.");
  const p = body.safeParse(await req.json().catch(() => null));
  const digits = p.success ? normalizeTaxId(p.data.tin) : null;
  if (!p.success || !digits) return fail(400, "bad_tin", "Enter the 9-digit SSN or EIN.");
  const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "tin", p_action: "saved" });
  if (error) return dbFail("subs.tin.save", error);
  const admin = createAdminClient();
  const last4 = digits.slice(-4);
  const { error: e1 } = await admin.from("pm_sensitive_ids").upsert({ resource_id: id, kind: "tin", sealed: sealPii(digits), last4, updated_by: g.userId, updated_at: new Date().toISOString() }, { onConflict: "resource_id,kind" });
  if (e1) { logError("subs.tin.store", e1); return fail(500, "store_failed", "We couldn't save the tax ID. Please try again."); }
  const { error: e2 } = await admin.from("pm_sub_tax_profiles").upsert({ resource_id: id, tin_type: p.data.tinType, tin_last4: last4, updated_by: g.userId, updated_at: new Date().toISOString() }, { onConflict: "resource_id" });
  if (e2) logError("subs.tin.last4", e2);
  return json({ ok: true, last4 }, 200);
}
