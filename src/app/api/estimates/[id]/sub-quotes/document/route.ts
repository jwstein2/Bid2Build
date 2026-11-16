import { NextResponse } from "next/server";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail } from "@/lib/http/api";
import { UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Open a quote document: RLS decides visibility, then a 5-minute signed link to the private file. */
export async function GET(req: Request, ctx: Ctx) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  const rev = new URL(req.url).searchParams.get("revision") ?? "";
  if (!UUID.test(id) || !UUID.test(rev)) return fail(404, "not_found", "Document not found.");
  const supabase = await createClient();
  const { data } = await supabase.from("subcontractor_quote_revisions").select("document_path, quote_id, subcontractor_quotes!inner(estimate_id)")
    .eq("id", rev).eq("subcontractor_quotes.estimate_id", id).maybeSingle();
  const path = (data as { document_path: string | null } | null)?.document_path;
  if (!path) return fail(404, "not_found", "Document not found.");
  const { data: signed } = await createAdminClient().storage.from("project-files").createSignedUrl(path, 300);
  if (!signed?.signedUrl) return fail(404, "not_found", "Document not found.");
  return NextResponse.redirect(signed.signedUrl, { headers: { "cache-control": "no-store" } });
}
