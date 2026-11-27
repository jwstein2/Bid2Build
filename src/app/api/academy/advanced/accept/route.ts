import { z } from "zod";
import { getStripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { AdvError, acceptQuote } from "@/lib/academy/advanced/checkout";
import { billingGuard } from "@/lib/academy/advanced/route-guard";

export const runtime = "nodejs";

const Body = z.object({ quote: z.string().uuid(), accept: z.literal(true), subject: z.string().regex(/^[a-z0-9-]{3,60}$/).optional() });

/** The customer saw and accepted the quoted price: open Stripe Checkout, or change their Academy subscription (upgrade). */
export async function POST(req: Request) {
  const g = await billingGuard("academy-accept", 20);
  if ("error" in g) return g.error;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Please confirm the price first.");
  try {
    return json(await acceptQuote(createAdminClient(), getStripe(), g.user, p.data.quote, p.data.subject ?? null));
  } catch (e) {
    if (e instanceof AdvError) return fail(e.status, e.code, e.message);
    logError("academy.accept", e, { user: g.user.id });
    return fail(500, "checkout_failed", "We couldn't start checkout. Please try again.");
  }
}
