"use server";
import { z } from "zod";
import { requireSalesRep } from "@/lib/sales/server";

export interface OpenedBox { ok: true; amount_cents: number; revenue_cents: number; pct: number; milestone: number }

/** Opens a ready milestone box and returns the bonus. The amount never reaches the browser before this. */
export async function openMilestone(id: string): Promise<OpenedBox | { ok: false; message: string }> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "That box wasn't found." };
  const { db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_my_milestone_open", { p_award: id });
  if (error || !data) return { ok: false, message: /not_ready/.test(error?.message ?? "") ? "This box isn't ready yet." : "Couldn't open the box. Try again." };
  const d = data as { amount_cents: number; revenue_cents: number; pct: number; milestone: number };
  return { ok: true, amount_cents: d.amount_cents, revenue_cents: d.revenue_cents, pct: Number(d.pct), milestone: d.milestone };
}

/** A rep questions a milestone award. The owner reviews it; the award's calculation never changes. */
export async function disputeMilestone(id: string, note: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = z.object({ id: z.string().uuid(), note: z.string().trim().min(3).max(1000) }).safeParse({ id, note });
  if (!p.success) return { ok: false, message: "Add a few words about what looks wrong." };
  const { db } = await requireSalesRep();
  const { error } = await db.rpc("sales_my_milestone_dispute", { p_award: p.data.id, p_note: p.data.note });
  if (error) return { ok: false, message: /already_disputed/.test(error.message ?? "") ? "You've already asked about this bonus. The owner will reply." : "Couldn't send that. Try again." };
  return { ok: true };
}
