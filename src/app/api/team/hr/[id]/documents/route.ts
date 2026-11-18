import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { MAX_QUOTE_FILE_BYTES, safeFileName, sniffDocument } from "@/lib/operations/server";
import { HR_DOC_TYPES } from "@/lib/team/hr";
import { hrFail } from "@/lib/team/hr-server";
import { guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const schema = z.object({
  docType: z.enum(HR_DOC_TYPES.map((d) => d.value) as [string, ...string[]]),
  title: z.string().trim().max(200).optional(), signedOn: date, expiresOn: date, note: z.string().trim().max(1000).optional(),
});
const MIME = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** Record an HR document (application, W-4, I-9, review...) with an optional file in the private hr-records bucket. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("hr-doc-add", 60);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Not found.");
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) return fail(400, "invalid", "Send the form with its file.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_QUOTE_FILE_BYTES + 64 * 1024) return fail(413, "too_large", "Files must be 15 MB or smaller.");
  const form = await req.formData().catch(() => null);
  if (!form) return fail(400, "invalid", "Check the details and try again.");
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && v.trim() !== "") fields[k] = v;
  const p = schema.safeParse(fields);
  if (!p.success) return fail(400, "invalid", "Check the details and try again.");
  // Permission first: no file is stored for someone who can't open this HR file.
  const { data: file, error: chk } = await g.supabase.rpc("pm_employee_hr_get", { p_resource_id: id });
  if (chk || !file) return hrFail("hr.doc.check", chk ?? { message: "not_found" });
  const { data: res } = await g.supabase.from("pm_resources").select("company_id, owner_id").eq("id", id).maybeSingle();
  const scope = (res as { company_id: string | null; owner_id: string | null } | null);
  const folder = scope ? `${scope.company_id ?? scope.owner_id}/${id}` : null;
  if (!folder) return fail(404, "not_found", "Not found.");

  const payload: Record<string, unknown> = { ...p.data };
  const f = form.get("file");
  if (f instanceof File && f.size > 0) {
    if (f.size > MAX_QUOTE_FILE_BYTES) return fail(413, "too_large", "Files must be 15 MB or smaller.");
    const buf = Buffer.from(await f.arrayBuffer());
    const kind = sniffDocument(buf);
    if (!kind) return fail(422, "invalid_file", "Upload a PDF, JPG, PNG or WebP.");
    const path = `${folder}/${randomUUID()}.${kind === "jpeg" ? "jpg" : kind}`;
    const { error } = await createAdminClient().storage.from("hr-records").upload(path, buf, { contentType: MIME[kind], upsert: false });
    if (error) { logError("hr.doc.upload", error); return fail(500, "upload_failed", "We couldn't store the file. Please try again."); }
    payload.filePath = path;
    payload.fileName = safeFileName(f.name);
  }
  const { data, error } = await g.supabase.rpc("pm_employee_document_add", { p_resource_id: id, p: payload });
  if (error) return hrFail("hr.doc.add", error);
  return json({ id: data as string }, 201);
}
