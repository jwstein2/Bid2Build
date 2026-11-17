import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead } from "@/lib/team/route-helpers";
import { map1099 } from "@/lib/team/records";

export const runtime = "nodejs";

/** Payments to each subcontractor in ?year (from Financials), for 1099-NEC preparation. */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const year = Number(new URL(req.url).searchParams.get("year") ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail(400, "invalid", "Pick a year.");
  const { data, error } = await g.supabase.rpc("pm_sub_1099_totals", { p_year: year });
  if (error) return dbFail("subs.1099", error);
  return json(map1099(data));
}
