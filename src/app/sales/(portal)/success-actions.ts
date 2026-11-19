"use server";
import { z } from "zod";
import { requireSalesRep } from "@/lib/sales/server";

/** Marks celebrations as seen so they play once. Creates nothing and moves no money. */
export async function markSuccessesSeen(ids: string[]): Promise<void> {
  const p = z.array(z.string().uuid()).max(60).safeParse(ids);
  if (!p.success || p.data.length === 0) return;
  const { db } = await requireSalesRep();
  await db.rpc("sales_my_successes_seen", { p_ids: p.data });
}
