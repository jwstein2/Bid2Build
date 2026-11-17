import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { validateOffer } from "@/lib/comms/nurture";
import { loadOffers, logEvent, requireComm } from "@/lib/comms/server";

export const runtime = "nodejs";

const Offer = z.object({
  id: z.string().uuid().optional(),
  name: z.string().max(120),
  offerType: z.enum(["percent", "fixed", "seasonal", "material", "financing", "custom"]),
  trades: z.array(z.string().max(60)).max(30).default([]),
  audience: z.array(z.enum(["lost", "unconverted", "old_draft", "completed", "past_customer"])).default([]),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  conditions: z.string().max(600).default(""),
  discountValue: z.number().positive().max(100000).nullable().default(null),
  message: z.string().max(600).default(""),
  materialCurrent: z.string().max(200).nullable().default(null),
  materialAlternative: z.string().max(200).nullable().default(null),
  priceBasis: z.enum(["verified", "contractor_estimate"]).nullable().default(null),
  estimatedSavings: z.string().max(200).nullable().default(null),
  active: z.boolean().default(false),
  /** The contractor reviewed and approves the material comparison wording. */
  approveComparison: z.boolean().default(false),
}).strict();

/** Create or update an offer. Offers start inactive; a material comparison needs explicit approval. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const g = await requireComm("edit_nurture_templates");
  if (!g.ok) return g.res;
  const p = Offer.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the offer details.");
  const o = p.data;
  const why = validateOffer(o);
  if (why) return fail(400, "invalid_offer", why);
  if (o.offerType === "material" && o.active && !o.approveComparison) {
    const { data: prev } = o.id ? await g.admin.from("comm_offers").select("comparison_approved_at, material_current, material_alternative, price_basis, estimated_savings").eq("id", o.id).eq("account_id", g.access.accountId).maybeSingle() : { data: null };
    const pv = prev as Record<string, unknown> | null;
    const same = pv && pv.comparison_approved_at && pv.material_current === o.materialCurrent && pv.material_alternative === o.materialAlternative && pv.price_basis === o.priceBasis && pv.estimated_savings === o.estimatedSavings;
    if (!same) return fail(400, "approve_comparison", "Review and approve the material comparison before turning this offer on.");
  }
  const row: Record<string, unknown> = {
    account_id: g.access.accountId, name: o.name.trim(), offer_type: o.offerType, trades: o.trades, audience: o.audience, starts_on: o.startsOn, ends_on: o.endsOn,
    conditions: o.conditions.trim(), discount_value: o.offerType === "percent" || o.offerType === "fixed" ? o.discountValue : null, message: o.message.trim(),
    material_current: o.offerType === "material" ? o.materialCurrent : null, material_alternative: o.offerType === "material" ? o.materialAlternative : null,
    price_basis: o.offerType === "material" ? o.priceBasis : null, estimated_savings: o.offerType === "material" ? o.estimatedSavings : null, active: o.active,
  };
  if (o.offerType === "material" && o.approveComparison) { row.comparison_approved_at = new Date().toISOString(); row.comparison_approved_by = g.userId; }
  const res = o.id ? await g.admin.from("comm_offers").update(row).eq("id", o.id).eq("account_id", g.access.accountId) : await g.admin.from("comm_offers").insert({ ...row, created_by: g.userId });
  if (res.error) return fail(400, "save_failed", "Could not save the offer.");
  await logEvent(g.admin, { accountId: g.access.accountId, kind: "settings", actorId: g.userId, details: { offer: o.name, active: o.active } });
  return json({ offers: await loadOffers(g.admin, g.access.accountId) });
}
