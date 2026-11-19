import { NextResponse, type NextRequest } from "next/server";
import { requireSalesAdmin } from "@/lib/sales/server";
import { detailSummary, rangeSince, type RepDetail } from "@/lib/sales/caps";
import { csv } from "@/lib/admin/csv";

/**
 * CSV of one rep's activity summary and leads for administrators with export_reports. Cells are
 * neutralized against spreadsheet formula injection. Reps have no export (V8.2 rule).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, db, has } = await requireSalesAdmin();
  if (!has("export_reports")) return new NextResponse("Not allowed", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const range = rangeSince(req.nextUrl.searchParams.get("range") ?? undefined);
  const { data, error } = await db.rpc("admin_sales_rep_detail", { p_caller: user.id, p_rep: id, p_since: range.since.toISOString(), p_until: range.until.toISOString() });
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  const d = data as RepDetail;
  await db.from("audit_logs").insert({ actor_id: user.id, action: "sales.rep_detail_exported", target_type: "sales_rep", target_id: id, details: { range: range.key } });
  const body =
    csv(["Rep", "From", "To"], [[d.rep.full_name, d.since.slice(0, 10), d.until.slice(0, 10)]]) + "\r\n" +
    csv(["Measure", "Value"], detailSummary(d)) + "\r\n" +
    csv(["Lead", "Stage", "Last activity", "Next step", "Do not contact"], d.leads.map((l) => [l.company_name, l.stage, l.last_activity_at?.slice(0, 10) ?? "", l.next_action_at?.slice(0, 10) ?? "", l.do_not_contact ? "yes" : ""]));
  const name = `rep-activity-${d.rep.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${range.key}.csv`;
  return new NextResponse(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
