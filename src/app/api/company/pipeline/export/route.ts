import { createClient, getUser } from "@/lib/supabase/server";
import { fail, logError, rateLimit } from "@/lib/http/api";
import { companyRpcError } from "@/lib/enterprise/errors";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { parseFilters, rpcArgs, toCsv, type PipelineRow } from "@/lib/enterprise/pipeline";

/** CSV of the bids the member can see, with the same filters as Bids & Pipeline (max 5,000 rows). */
export async function GET(req: Request) {
  if (!(await rateLimit("company-pipeline-export", 20, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const company = await loadMyCompany(supabase);
  if (!company) return fail(403, "not_a_member", "You're not part of a company account.");
  const f = parseFilters(new URL(req.url).searchParams);
  const { data, error } = await supabase.rpc("company_pipeline_bids", rpcArgs(f, 5000));
  if (error) {
    const e = companyRpcError(error);
    if (e.status >= 500) logError("company.pipeline.export", error);
    return fail(e.status, e.code, e.message);
  }
  const csv = toCsv((data ?? []) as PipelineRow[], can(company, "view_margin"));
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bids-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
