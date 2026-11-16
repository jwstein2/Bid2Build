import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { PAY_METHODS, sanitizePay } from "@/lib/pipeline/sales-pay";

const Body = z.object({
  method: z.enum(Object.keys(PAY_METHODS) as [keyof typeof PAY_METHODS, ...(keyof typeof PAY_METHODS)[]]),
  rate: z.number().min(0).max(100), flatFee: z.number().min(0).max(1_000_000),
  baseSalary: z.number().min(0).max(10_000_000), baseExclusions: z.number().min(0).max(100),
});

/** Saves the signed-in user's own sales pay settings. RLS limits the row to its owner; nobody else can read it. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("pipeline-pay", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the numbers and try again.");
  const s = sanitizePay(p.data);
  const supabase = await createClient();
  const { error } = await supabase.from("sales_pay_settings").upsert({
    user_id: user.id, method: s.method, rate: s.rate, flat_fee: s.flatFee, base_salary: s.baseSalary, base_exclusions: s.baseExclusions, updated_at: new Date().toISOString(),
  });
  if (error) {
    if (error.code === "42P01" || /sales_pay_settings/.test(error.message ?? "")) return fail(409, "migration_pending", "Saving needs a quick database update. Your numbers still work on this device.");
    logError("pipeline.pay", error);
    return fail(500, "save_failed", "Couldn't save. Please try again.");
  }
  return json({ ok: true });
}
