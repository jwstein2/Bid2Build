"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesRep } from "@/lib/sales/server";
import { GOAL_KINDS } from "@/lib/sales/business";

function back(q: string): never { revalidatePath("/sales/business"); revalidatePath("/sales"); redirect(`/sales/business?${q}#goals`); }

/** A goal the rep chooses for this month. Optional, and never used to rank or judge anyone. */
export async function saveGoal(fd: FormData) {
  const { db } = await requireSalesRep();
  const kind = String(fd.get("kind") ?? "");
  const raw = Number(fd.get("target"));
  if (!(kind in GOAL_KINDS) || !Number.isFinite(raw) || raw <= 0) back("err=goal");
  const target = GOAL_KINDS[kind].unit === "cents" ? Math.round(raw * 100) : Math.round(raw);
  const { error } = await db.rpc("sales_my_goal_save", { p_kind: kind, p_target: Math.min(target, 10_000_000) });
  back(error ? "err=goal" : "ok=goal");
}

export async function deleteGoal(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (id.success) await db.rpc("sales_my_goal_delete", { p_id: id.data });
  back("ok=removed");
}
