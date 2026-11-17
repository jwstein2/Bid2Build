import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite, UUID_RE } from "@/lib/team/route-helpers";
import { mapSubRecord } from "@/lib/team/records";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

const date = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullish();
const body = z.object({
  legalName: z.string().trim().max(200).nullish(),
  businessName: z.string().trim().max(200).nullish(),
  taxClassification: z.union([z.literal(""), z.enum(["individual", "c_corp", "s_corp", "partnership", "trust_estate", "llc_c", "llc_s", "llc_p", "other"])]).nullish(),
  tinType: z.union([z.literal(""), z.enum(["ssn", "ein"])]).nullish(),
  // Only the last 4 digits are accepted. A full SSN/EIN is never sent to or stored by the database.
  tinLast4: z.union([z.literal(""), z.string().regex(/^\d{4}$/)]).nullish(),
  address: z.string().trim().max(500).nullish(),
  w9SignedOn: date,
  track1099: z.boolean().nullable().optional(),
});

/** A subcontractor's W-9 details and documents. Owner / "Manage subcontractor compliance" only. */
export async function GET(_req: Request, ctx: Ctx) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  const { data, error } = await g.supabase.rpc("pm_sub_record", { p_resource_id: id });
  if (error) return dbFail("subs.record", error);
  return json(mapSubRecord(data));
}

/** Save W-9 details (last 4 of the tax ID only). */
export async function POST(req: Request, ctx: Ctx) {
  const g = await guardWrite("sub-tax-save", 60);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!UUID_RE.test(id) || !p.success) {
    return fail(400, "invalid", p.success ? "Check the details and try again." : p.error.issues.some((i) => i.path[0] === "tinLast4") ? "Enter only the last 4 digits of the SSN or EIN." : "Check the details and try again.");
  }
  const { error } = await g.supabase.rpc("pm_sub_tax_save", { p_resource_id: id, p: { ...p.data, track1099: p.data.track1099 ?? null } });
  if (error) return dbFail("subs.tax", error);
  return json({ ok: true });
}
