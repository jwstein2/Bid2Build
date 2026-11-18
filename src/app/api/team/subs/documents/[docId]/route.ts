import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ docId: string }> };

/** Open a document's file through a 60-second private link, after the database permission check. */
export async function GET(_req: Request, ctx: Ctx) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { docId } = await ctx.params;
  if (!UUID_RE.test(docId)) return fail(404, "not_found", "Not found.");
  const { data, error } = await g.supabase.rpc("pm_sub_document_file", { p_id: docId });
  if (error) return dbFail("subs.doc.file", error);
  const path = (data as { path?: string } | null)?.path;
  if (!path) return fail(404, "not_found", "No file on this record.");
  const signed = await createAdminClient().storage.from("sub-records").createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) { logError("subs.doc.sign", signed.error); return fail(500, "server_error", "We couldn't open the file. Please try again."); }
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/** Remove a document recorded by mistake (kept in history as removed). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guardWrite("sub-doc-remove", 60);
  if (!g.ok) return g.res;
  const { docId } = await ctx.params;
  if (!UUID_RE.test(docId)) return fail(404, "not_found", "Not found.");
  const { error } = await g.supabase.rpc("pm_sub_document_remove", { p_id: docId });
  if (error) return dbFail("subs.doc.remove", error);
  return json({ ok: true });
}
