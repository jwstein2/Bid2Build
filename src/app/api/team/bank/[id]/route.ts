import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { openPii, piiReady, sealPii } from "@/lib/security/pii";
import { normalizeAccountNumber } from "@/lib/team/hr";
import { dbFail, guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/**
 * A bank account number for direct deposit (employee) or ACH payments (subcontractor). Encrypted before it's
 * stored, like SSNs and TINs. pm_sensitive_log checks the permission as the signed-in user (employee: owner and
 * HR managers; subcontractor: people who manage subcontractor compliance) and records the access BEFORE the
 * server touches the encrypted value. Never logged or exported. Bank name, account type and routing number are
 * saved with the rest of the record.
 */
function denied(where: string, error: { message?: string; code?: string }) {
  if (/forbidden/.test(error.message ?? "") || error.code === "42501") return fail(403, "forbidden", "You don't have access to this bank account.");
  return dbFail(where, error);
}

export async function GET(_req: Request, ctx: Ctx) {
  const g = await guardWrite("bank-view", 30);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  if (!piiReady()) return fail(503, "pii_off", "Bank account numbers turn on once the encryption key is set.");
  const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "bank", p_action: "revealed" });
  if (error) return denied("bank.view", error);
  const { data } = await createAdminClient().from("pm_sensitive_ids").select("sealed").eq("resource_id", id).eq("kind", "bank").maybeSingle();
  if (!data) return fail(404, "not_found", "No bank account number on file.");
  try {
    return new Response(JSON.stringify({ account: openPii(String((data as { sealed: string }).sealed)) }), {
      status: 200, headers: { "content-type": "application/json", "cache-control": "private, no-store, max-age=0" },
    });
  } catch (e) {
    logError("bank.open", e);
    return fail(500, "pii_error", "We couldn't read this number.");
  }
}

const body = z.object({ account: z.string().max(30) });

export async function POST(req: Request, ctx: Ctx) {
  const g = await guardWrite("bank-save", 30);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  if (!piiReady()) return fail(503, "pii_off", "Bank account numbers turn on once the encryption key is set.");
  const p = body.safeParse(await req.json().catch(() => null));
  const digits = p.success ? normalizeAccountNumber(p.data.account) : null;
  if (!digits) return fail(400, "bad_account", "Enter the bank account number (4 to 17 digits).");
  const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "bank", p_action: "saved" });
  if (error) return denied("bank.save", error);
  const { error: e1 } = await createAdminClient().from("pm_sensitive_ids").upsert(
    { resource_id: id, kind: "bank", sealed: sealPii(digits), last4: digits.slice(-4), updated_by: g.userId, updated_at: new Date().toISOString() }, { onConflict: "resource_id,kind" });
  if (e1) { logError("bank.store", { code: (e1 as { code?: string }).code }); return fail(500, "store_failed", "We couldn't save the number. Please try again."); }
  return json({ ok: true, last4: digits.slice(-4) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guardWrite("bank-save", 30);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "bank", p_action: "removed" });
  if (error) return denied("bank.remove", error);
  await createAdminClient().from("pm_sensitive_ids").delete().eq("resource_id", id).eq("kind", "bank");
  return json({ ok: true });
}
