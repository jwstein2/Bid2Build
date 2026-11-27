import { z } from "zod";
import { getStripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { ADV_PLANS } from "@/lib/academy/advanced/plans";
import { AdvError, createQuote } from "@/lib/academy/advanced/checkout";
import { billingGuard } from "@/lib/academy/advanced/route-guard";

export const runtime = "nodejs";

const Body = z.object({ plan: z.enum(ADV_PLANS), subject: z.string().regex(/^[a-z0-9-]{3,60}$/) });

/** Price quote + founding-slot reservation. The browser sends only a package and a subject; the server decides the rest. */
export async function POST(req: Request) {
  const g = await billingGuard("academy-quote", 30);
  if ("error" in g) return g.error;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose a package.");
  try {
    const quote = await createQuote(createAdminClient(), getStripe(), g.user, g.mode, p.data.plan, p.data.subject);
    return json({ quote });
  } catch (e) {
    if (e instanceof AdvError) return fail(e.status, e.code, e.message);
    logError("academy.quote", e, { user: g.user.id, plan: p.data.plan });
    return fail(500, "quote_failed", "We couldn't get a price right now. Please try again.");
  }
}
