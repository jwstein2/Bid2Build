import { requireSalesAdmin } from "@/lib/sales/server";
import { payrollCsv } from "@/lib/sales/compensation";

export const runtime = "nodejs";

/** One month's statement lines as CSV for payroll (owner only): standard commissions and one-time bonuses labeled separately. */
export async function GET(req: Request) {
  const { user, db, has } = await requireSalesAdmin();
  if (!has("payout_operations")) return new Response("Not allowed.", { status: 403 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Pick a month (YYYY-MM).", { status: 400 });
  const { data, error } = await db.rpc("admin_sales_payroll_export", { p_caller: user.id, p_month: `${month}-01` });
  if (error) return new Response("Payroll export isn't available.", { status: 500 });
  const csv = payrollCsv(((data as { lines?: Parameters<typeof payrollCsv>[0] })?.lines ?? []));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="built2bid-sales-payroll-${month}.csv"`, "cache-control": "no-store" } });
}
