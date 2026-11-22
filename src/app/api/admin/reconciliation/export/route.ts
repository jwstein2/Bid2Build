import { requireStaffCap } from "@/lib/staff/server";
import { reportCsv } from "@/lib/reconciliation/facts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Monthly reconciliation report as CSV (owner, finance, external accountant: reports.export). A closed month returns the
 * stored report exactly as it was closed (with its SHA-256); an open month is computed now. Audited.
 */
export async function GET(req: Request) {
  const { user, db } = await requireStaffCap("reports.export");
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Bad month", { status: 400 });
  const { data, error } = await db.rpc("admin_recon_period", { p_caller: user.id, p_month: `${month}-01` });
  if (error || !data) return new Response("Not available", { status: 503 });
  await db.rpc("staff_audit", { p_actor: user.id, p_action: "recon.report_exported", p_type: "recon_period", p_id: month, p_details: null });
  return new Response(reportCsv(data as Record<string, unknown>), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="built2bid-reconciliation-${month}.csv"`, "cache-control": "no-store" },
  });
}
