import { csv } from "@/lib/admin/csv";
import { requireStaffCap } from "@/lib/staff/server";
import type { PayoutRow } from "@/components/payouts/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accounting export of the payout ledger (owner, finance, external accountant: reports.export). Formula-safe CSV,
 * one row per payout item so each original earning is visible with its payout's fee and net. Audited.
 */
export async function GET(req: Request) {
  const { user, db } = await requireStaffCap("reports.export");
  const mode = new URL(req.url).searchParams.get("mode");
  const { data, error } = await db.rpc("admin_payouts_overview", { p_caller: user.id });
  if (error) return new Response("Not available", { status: 503 });
  const rows = ((data as { payouts: PayoutRow[] }).payouts).filter((p) => !mode || p.mode === mode);
  await db.rpc("staff_audit", { p_actor: user.id, p_action: "payout.exported", p_type: "payouts", p_id: "csv", p_details: { rows: rows.length, mode } });
  const body = csv(
    ["payout_ref", "mode", "recipient", "status", "item", "item_amount_usd", "payout_gross_usd", "adjustments_usd", "provider_fee_usd", "fee_paid_by", "fee_reason", "federal_withheld_usd", "state_withheld_usd", "tax_state", "net_usd",
      "scheduled_for", "submitted_at", "settled_at", "failure_code", "provider", "provider_ref", "funding_source", "reconciliation"],
    rows.flatMap((p) => (p.items.length ? p.items : [{ description: "", amount_cents: 0 } as PayoutRow["items"][number]]).map((i) => [
      p.ref, p.mode, p.staff_name, p.status, i.description ?? "", (i.amount_cents / 100).toFixed(2), (p.gross_cents / 100).toFixed(2), (p.adjustments_cents / 100).toFixed(2),
      (p.fee_cents / 100).toFixed(2), p.fee_bearer, p.fee_reason ?? "", ((p.withholding_cents ?? 0) / 100).toFixed(2), ((p.state_withholding_cents ?? 0) / 100).toFixed(2), p.tax_state ?? "", (p.net_cents / 100).toFixed(2), p.scheduled_for, p.submitted_at ?? "", p.settled_at ?? "",
      p.failure_code ?? "", p.provider, p.provider_ref ?? "", p.funding_source ?? "", p.reconciliation])));
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="built2bid-payouts-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
}
