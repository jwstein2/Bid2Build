import { NextResponse, type NextRequest } from "next/server";
import { createClient, getUser } from "@/lib/supabase/server";
import { csvCell } from "@/lib/admin/csv";

const csvRow = (r: unknown[]) => r.map(csvCell).join(",");

export const dynamic = "force-dynamic";

/** One payout statement as CSV, for the signed-in staff member's own payouts only (staff_my_payouts is self-scoped). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  const { ref } = await params;
  const { data, error } = await (await createClient()).rpc("staff_my_payouts");
  type P = { ref: string; mode: string; status: string; gross_cents: number; fee_cents: number; fee_bearer: string; net_cents: number; scheduled_for: string; settled_at: string | null;
    destination: { institution_name: string | null; last4: string | null } | null; items: { source_kind: string; description: string | null; amount_cents: number; active: boolean }[] };
  const p = error ? null : ((data as { payouts: P[] } | null)?.payouts ?? []).find((x) => x.ref === ref);
  if (!p) return new NextResponse("Not found.", { status: 404 });
  const $ = (c: number) => (c / 100).toFixed(2);
  const lines = [
    csvRow(["Built2Bid payout statement", p.ref]), csvRow(["Mode", p.mode === "test" ? "TEST (no money moved)" : "live"]), csvRow(["Status", p.status]),
    csvRow(["Scheduled", p.scheduled_for]), csvRow(["Settled", p.settled_at ?? ""]), csvRow(["Deposit account", p.destination ? `${p.destination.institution_name ?? "Bank"} ••${p.destination.last4 ?? ""}` : ""]), "",
    csvRow(["Item", "Type", "Amount (USD)"]),
    ...p.items.filter((i) => i.active).map((i) => csvRow([i.description ?? "", i.source_kind, $(i.amount_cents)])), "",
    csvRow(["Gross earned", "", $(p.gross_cents)]),
    csvRow(["Processing fee", p.fee_bearer === "recipient" ? "deducted" : "paid by Built2Bid", p.fee_bearer === "recipient" ? $(p.fee_cents) : "0.00"]),
    csvRow(["Net deposit", "", $(p.net_cents)]),
  ];
  return new NextResponse(lines.join("\r\n") + "\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${p.ref.replace(/[^A-Za-z0-9-]/g, "")}.csv"`, "cache-control": "no-store" } });
}
