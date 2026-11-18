import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { formatTaxId, normalizeTaxId, openPii, piiReady, sealPii } from "@/lib/security/pii";
import { hrFail } from "@/lib/team/hr-server";
import { guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

/**
 * An employee's Social Security number. Encrypted before it's stored; only the owner and HR managers may
 * save, view or remove it, and pm_sensitive_log records each of those (as the signed-in user, which also
 * enforces the permission) before the server touches the encrypted value. Never logged or exported.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-ssn-view", 30);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  if (!piiReady()) return fail(503, "pii_off", "Social Security numbers turn on once the encryption key is set.");
  const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "ssn", p_action: "revealed" });
  if (error) return hrFail("hr.ssn.view", error);
  const { data } = await createAdminClient().from("pm_sensitive_ids").select("sealed").eq("resource_id", id).eq("kind", "ssn").maybeSingle();
  if (!data) return fail(404, "not_found", "No Social Security number on file.");
  try {
    return new Response(JSON.stringify({ ssn: formatTaxId(openPii(String((data as { sealed: string }).sealed)), "ssn") }), {
      status: 200, headers: { "content-type": "application/json", "cache-control": "private, no-store, max-age=0" },
    });
  } catch (e) {
    logError("hr.ssn.open", e);
    return fail(500, "pii_error", "We couldn't read this number.");
  }
}

const body = z.object({ ssn: z.string().max(20) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-ssn-save", 30);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  if (!piiReady()) return fail(503, "pii_off", "Social Security numbers turn on once the encryption key is set.");
  const p = body.safeParse(await req.json().catch(() => null));
  const digits = p.success ? normalizeTaxId(p.data.ssn) : null;
  if (!digits) return fail(400, "bad_ssn", "Enter the 9-digit Social Security number.");
  const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "ssn", p_action: "saved" });
  if (error) return hrFail("hr.ssn.save", error);
  const { error: e1 } = await createAdminClient().from("pm_sensitive_ids").upsert(
    { resource_id: id, kind: "ssn", sealed: sealPii(digits), last4: digits.slice(-4), updated_by: g.userId, updated_at: new Date().toISOString() }, { onConflict: "resource_id,kind" });
  if (e1) { logError("hr.ssn.store", { code: (e1 as { code?: string }).code }); return fail(500, "store_failed", "We couldn't save the number. Please try again."); }
  return json({ ok: true, last4: digits.slice(-4) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-ssn-save", 30);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "ssn", p_action: "removed" });
  if (error) return hrFail("hr.ssn.remove", error);
  await createAdminClient().from("pm_sensitive_ids").delete().eq("resource_id", id).eq("kind", "ssn");
  return json({ ok: true });
}
