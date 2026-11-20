import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { MAX_QUOTE_FILE_BYTES, safeFileName, sniffDocument } from "@/lib/operations/server";
import { dbFail, guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const schema = z.object({
  docType: z.enum(["w9", "coi_general_liability", "workers_comp", "auto_liability", "umbrella", "license", "subcontract_agreement", "master_agreement", "lien_waiver", "other",
    "wc_exemption", "bond", "safety_program", "prequalification"]),
  title: z.string().trim().max(200).optional(),
  issuer: z.string().trim().max(200).optional(),
  policyNumber: z.string().trim().max(80).optional(),
  coverageAmount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),
  aggregateAmount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),
  // COI endorsements, sent as "yes" / "no" from the form (left out = not recorded).
  additionalInsured: z.enum(["yes", "no"]).optional(),
  waiverOfSubrogation: z.enum(["yes", "no"]).optional(),
  primaryNoncontributory: z.enum(["yes", "no"]).optional(),
  effectiveOn: date, expiresOn: date, signedOn: date,
  note: z.string().trim().max(1000).optional(),
});
const MIME = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/**
 * Record a W-9, insurance certificate, license, agreement or lien waiver, with an optional file (PDF or
 * image, checked by content). Files go to the private sub-records bucket under the subcontractor's folder.
 * Permission is checked by the database before anything is stored.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardWrite("sub-doc-add", 60);
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

  // Permission + scope first (no file is stored for someone who can't record documents).
  const { data: rec, error: recErr } = await g.supabase.rpc("pm_sub_record", { p_resource_id: id });
  if (recErr) return dbFail("subs.doc.check", recErr);
  const folder = (rec as { folder?: string } | null)?.folder;
  if (!folder || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(folder)) return fail(404, "not_found", "Not found.");

  const payload: Record<string, unknown> = { ...p.data };
  for (const k of ["additionalInsured", "waiverOfSubrogation", "primaryNoncontributory"] as const) if (p.data[k]) payload[k] = p.data[k] === "yes";
  const f = form.get("file");
  if (f instanceof File && f.size > 0) {
    if (f.size > MAX_QUOTE_FILE_BYTES) return fail(413, "too_large", "Files must be 15 MB or smaller.");
    const buf = Buffer.from(await f.arrayBuffer());
    const kind = sniffDocument(buf);
    if (!kind) return fail(422, "invalid_file", "Upload a PDF, JPG, PNG or WebP.");
    const path = `${folder}/${randomUUID()}.${kind === "jpeg" ? "jpg" : kind}`;
    const { error } = await createAdminClient().storage.from("sub-records").upload(path, buf, { contentType: MIME[kind], upsert: false });
    if (error) { logError("subs.doc.upload", error); return fail(500, "upload_failed", "We couldn't store the file. Please try again."); }
    payload.filePath = path;
    payload.fileName = safeFileName(f.name);
  }
  const { data, error } = await g.supabase.rpc("pm_sub_document_add", { p_resource_id: id, p: payload });
  if (error) return dbFail("subs.doc.add", error);
  return json({ id: data as string }, 201);
}
