"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/admin/server";
import { CHANNELS } from "@/lib/admin/channels";

/**
 * Manual marketing spend (public.marketing_costs), so CAC is only ever computed from real costs the
 * owner entered. Owner-only (requireAdmin) and audited. Never touches an ad platform.
 */
const Cost = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  channel: z.enum(CHANNELS.map((c) => c.key) as [string, ...string[]]),
  campaign: z.string().trim().max(128).regex(/^[\w .:@+\-/|]*$/, "Letters, numbers and - _ . : / only").optional(),
  amount: z.coerce.number().min(0).max(1_000_000),
  note: z.string().trim().max(500).optional(),
});

export async function addCost(form: FormData) {
  const { user, db } = await requireAdmin();
  const p = Cost.safeParse({ month: form.get("month"), channel: form.get("channel"), campaign: form.get("campaign") || undefined, amount: form.get("amount"), note: form.get("note") || undefined });
  if (!p.success) redirect(`/admin/marketing?spend_error=${encodeURIComponent(p.error.issues[0]?.message ?? "Check the spend fields")}#spend`);
  const v = p.data;
  const { data, error } = await db.from("marketing_costs").insert({ period_start: `${v.month}-01`, channel: v.channel, campaign_id: v.campaign || null, amount_usd: v.amount, note: v.note || null, created_by: user.id }).select("id").single();
  if (error) redirect(`/admin/marketing?spend_error=${encodeURIComponent("Could not save. Is the growth funnel migration installed?")}#spend`);
  await audit(db, user.id, "marketing_cost.add", "marketing_cost", String(data.id), { month: v.month, channel: v.channel, campaign: v.campaign ?? null, amount_usd: v.amount });
  revalidatePath("/admin/marketing");
  redirect("/admin/marketing?spend_saved=1#spend");
}

export async function deleteCost(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) redirect("/admin/marketing#spend");
  const { data } = await db.from("marketing_costs").select("period_start,channel,campaign_id,amount_usd").eq("id", id).maybeSingle();
  if (data) {
    await audit(db, user.id, "marketing_cost.delete", "marketing_cost", String(id), data as Record<string, unknown>);
    await db.from("marketing_costs").delete().eq("id", id);
  }
  revalidatePath("/admin/marketing");
  redirect("/admin/marketing#spend");
}
