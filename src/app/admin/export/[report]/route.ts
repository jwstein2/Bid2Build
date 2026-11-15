import { notFound } from "next/navigation";
import { CHANNEL_LABEL } from "@/lib/admin/channels";
import { filterCustomers, parseCustomerFilters, planText } from "@/lib/admin/customers";
import { loadReport } from "@/lib/admin/load";
import { parseStateFilters, stateReport } from "@/lib/admin/metrics";
import { channelReport, usageModel, windowOf, SEGMENT_LABEL } from "@/lib/admin/model";
import { tradeName } from "@/lib/trades/catalog";
import { US_STATES } from "@/lib/market/geo";
import { csv } from "@/lib/admin/csv";

export const dynamic = "force-dynamic";

/**
 * Owner-only CSV exports of aggregated reports and the account summary. Authorized by loadReport()
 * (requireAdmin → 404 for anyone else). Never exports bid contents, prices, homeowner details,
 * tokens or auth metadata beyond email/verified/sign-up dates.
 */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  if (!["customers", "states", "channels", "trades"].includes(report)) notFound();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { r } = await loadReport(sp);
  if (!r) return new Response("Report unavailable", { status: 503 });
  const date = r.now.toISOString().slice(0, 10);
  const scopeTag = r.view.includeTest ? "-incl-test" : "";
  let body: string;
  if (report === "customers") {
    const rows = filterCustomers(r.facts, parseCustomerFilters(sp));
    body = csv(["business", "email", "email_verified", "account_type", "plan", "segment", "signed_up", "last_bid_activity", "bids_started", "bids_finalized", "proposals_signed", "first_finalized", "channel"],
      rows.map((f) => [f.business ?? "", f.email ?? "", f.confirmed ? "yes" : "no", f.cls, planText(f), SEGMENT_LABEL[f.segment], f.createdAt.slice(0, 10), f.lastActivityAt?.slice(0, 10) ?? "", f.estimates, f.finalized, f.signed, f.firstFinalizedAt?.slice(0, 10) ?? "", CHANNEL_LABEL[f.channel]]));
  } else if (report === "states") {
    const s = stateReport(r.sc.d, parseStateFilters(sp), r.now);
    body = csv(["state", "name", "bids", "businesses", "accounts", "finalized", "signed", "zip_entered_pct", "top_trades"],
      s.rows.map((x) => [x.state, US_STATES[x.state] ?? x.state, x.bids, x.businesses, x.accounts, x.finalized, x.signed, x.completeness, x.topTrades.map((t) => `${tradeName(t.trade)} ${t.n}`).join("; ")]));
  } else if (report === "channels") {
    const w = windowOf(r.view.range, r.now);
    body = csv(["channel", "signups", "started_bid", "activated", "paying", "mrr_usd_list_price", "spend_usd", "cac_usd", "cost_per_activation_usd"],
      channelReport(r.facts, r.snap.costs, w.start, w.end).map((c) => [c.label, c.signups, c.firstBid, c.activated, c.paid, (c.mrrCents / 100).toFixed(2), c.spendUsd?.toFixed(2) ?? "", c.cacUsd?.toFixed(2) ?? "", c.costPerActivationUsd?.toFixed(2) ?? ""]));
  } else {
    const u = usageModel(r.sc, r.facts, r.view.range, r.now);
    body = csv(["trade", "bids", "previous_period_bids", "finalized", "signed"], u.trades.map((t) => [tradeName(t.trade), t.bids, t.prev, t.finalized, t.signed]));
  }
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="built2bid-${report}${scopeTag}-${date}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
