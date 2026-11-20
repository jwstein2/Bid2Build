import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardWrite, UUID_RE } from "@/lib/team/route-helpers";
import { DIVERSITY_CERTS } from "@/lib/team/records";

export const runtime = "nodejs";

const blank = z.literal("");
const body = z.object({
  paymentTerms: z.string().trim().max(60).nullish(),
  retainagePct: z.union([blank, z.number().min(0).max(50)]).nullish(),
  backupWithholding: z.boolean().optional(),
  emr: z.union([blank, z.number().min(0).max(5)]).nullish(),
  yearsInBusiness: z.union([blank, z.number().int().min(0).max(300)]).nullish(),
  diversityCerts: z.array(z.enum(Object.keys(DIVERSITY_CERTS) as [keyof typeof DIVERSITY_CERTS, ...(keyof typeof DIVERSITY_CERTS)[]])).max(8).optional(),
  website: z.string().trim().max(300).nullish(),
  achBankName: z.string().trim().max(100).nullish(),
  achAccountType: z.union([blank, z.enum(["checking", "savings"])]).nullish(),
  achRouting: z.union([blank, z.string().regex(/^\d{9}$/)]).nullish(),
  prequalifiedOn: z.union([blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullish(),
}).strict();

/** Save a subcontractor's business profile (payment terms, retainage, safety, diversity, ACH details). Partial. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("sub-profile-save", 60);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", p.error.issues.some((i) => i.path[0] === "achRouting") ? "Enter the 9-digit routing number." : "Check the details and try again.");
  const { error } = await g.supabase.rpc("pm_sub_profile_save", { p_resource_id: id, p: p.data });
  if (error) return dbFail("subs.profile", error);
  return json({ ok: true });
}
