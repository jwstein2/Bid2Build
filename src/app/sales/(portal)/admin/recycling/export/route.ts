import { requireSalesAdmin } from "@/lib/sales/server";
import { recycleCsv } from "@/lib/sales/leads-admin";

export const runtime = "nodejs";

/** Lead recycling history as CSV, for sales administrators who can see all leads. */
export async function GET(req: Request) {
  const { user, db, has } = await requireSalesAdmin();
  if (!has("view_all_leads") || !has("export_reports")) return new Response("Not allowed.", { status: 403 });
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days")) || 90, 1), 730);
  const { data, error } = await db.rpc("admin_sales_recycle_history", { p_caller: user.id, p_days: days });
  if (error) return new Response("Recycling history isn't available.", { status: 500 });
  const csv = recycleCsv((data ?? []) as Parameters<typeof recycleCsv>[0]);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="lead-recycling-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
}
