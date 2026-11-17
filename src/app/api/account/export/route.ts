import { createClient, getUser } from "@/lib/supabase/server";
import { fail, logError } from "@/lib/http/api";
import { buildExport, type ExportClient } from "@/lib/account/export";

export const runtime = "nodejs";

/** Data portability: everything the signed-in user can see, read through RLS. See src/lib/account/export.ts. */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  try {
    const supabase = await createClient();
    const out = await buildExport(supabase as unknown as ExportClient, { id: user.id, email: user.email });
    return new Response(JSON.stringify(out, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="built2bid-export-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" },
    });
  } catch (e) {
    logError("account.export", e, { user: user.id });
    return fail(500, "export_failed", "We couldn't build your export. Please try again.");
  }
}
