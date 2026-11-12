import { z } from "zod";
import { configuredProviders, suggestPrice } from "@/lib/pricing/provider";
import { fail, json, rateLimit } from "@/lib/http/api";

export async function POST(req: Request) {
  if (!(await rateLimit("pricing", 60, 60_000))) return fail(429, "rate_limited", "Too many requests.");
  const p = z.object({ itemName: z.string().max(300), costType: z.string().max(30), unit: z.string().max(40), region: z.object({ zip: z.string().max(10).optional(), city: z.string().max(100).optional(), state: z.string().max(50).optional() }) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  return json(await suggestPrice(p.data, { providers: configuredProviders() }));
}
