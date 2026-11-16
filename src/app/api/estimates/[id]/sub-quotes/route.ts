import { z } from "zod";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { MAX_QUOTE_FILE_BYTES, opsDbError, safeFileName, sniffDocument, storeProjectFile, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/);
const schema = z.object({
  quoteId: z.string().regex(UUID).optional(),
  itemId: z.string().regex(UUID).optional(),
  resourceId: z.string().regex(UUID).optional(),
  vendorName: z.string().trim().max(200).optional(),
  amount: money.optional(),
  quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(2000).optional(),
  internalNotes: z.string().max(4000).optional(),
  status: z.enum(["received", "under_review", "accepted", "rejected"]).optional(),
}).refine((v) => v.quoteId || v.itemId, { message: "itemId or quoteId required" });

/**
 * Record a subcontractor quote on an estimate line item, or a revised amount / note / status on an
 * existing quote. Accepts multipart (with an optional quote document) or JSON. Values are stored as
 * UNAPPROVED: nothing here changes the estimate, its prices or the internal cost forecast.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("sub-quote", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Bid not found.");

  let fields: Record<string, unknown> = {};
  let file: File | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_QUOTE_FILE_BYTES + 64 * 1024) return fail(413, "too_large", "Quote documents must be 15 MB or smaller.");
    const form = await req.formData().catch(() => null);
    if (!form) return fail(400, "invalid", "Check the quote details and try again.");
    for (const [k, v] of form.entries()) if (typeof v === "string" && v !== "") fields[k] = v;
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
  } else {
    fields = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  }
  const p = schema.safeParse(fields);
  if (!p.success) return fail(400, "invalid", "Check the quote details and try again.");

  const supabase = await createClient();
  const { data: allowed, error: permErr } = await supabase.rpc("can_record_sub_quotes", { p_estimate_id: id });
  if (permErr || !allowed) return fail(403, "forbidden", "You don't have permission to record subcontractor quotes on this bid.");
  const { data: est } = await supabase.from("estimates").select("id, user_id, company_id").eq("id", id).maybeSingle();
  if (!est) return fail(404, "not_found", "Bid not found.");

  const payload: Record<string, unknown> = { ...p.data };
  if (file) {
    if (file.size > MAX_QUOTE_FILE_BYTES) return fail(413, "too_large", "Quote documents must be 15 MB or smaller.");
    if (!p.data.amount) return fail(400, "amount_required", "Enter the quote amount with the document.");
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniffDocument(buf);
    if (!kind) return fail(422, "invalid_file", "Upload the quote as a PDF, JPG, PNG or WebP.");
    try {
      payload.documentPath = await storeProjectFile(createAdminClient(), (est.company_id ?? est.user_id) as string, `sub-quotes/${id}`, buf, kind);
      payload.documentName = safeFileName(file.name);
    } catch (e) {
      logError("sub_quote.upload", e);
      return fail(500, "upload_failed", "We couldn't store the document. Please try again.");
    }
  }
  const { data, error } = await supabase.rpc("sub_quote_record", { p_estimate_id: id, p: payload });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("sub_quote.record", error);
    return fail(m.status, m.code, m.message);
  }
  return json(data, 201);
}
