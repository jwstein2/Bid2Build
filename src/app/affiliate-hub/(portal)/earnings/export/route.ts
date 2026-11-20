import { createClient, getUser } from "@/lib/supabase/server";
import { entries, filterEntries, toCsv, type Dashboard } from "@/lib/affiliates/portfolio";

export const dynamic = "force-dynamic";

/** CSV of the signed-in affiliate's earnings (own rows only, privacy-safe customer labels), with the page's filters. */
export async function GET(req: Request) {
  if (!(await getUser())) return new Response("Sign in required", { status: 401 });
  const { data, error } = await (await createClient()).rpc("affiliate_my_dashboard");
  if (error || !data) return new Response("Not available", { status: 403 });
  const u = new URL(req.url).searchParams;
  const rows = filterEntries(entries(data as Dashboard), { year: u.get("year") ?? undefined, month: u.get("month") ?? undefined, campaign: u.get("campaign") ?? undefined, status: u.get("status") ?? undefined });
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="built2bid-affiliate-earnings-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
