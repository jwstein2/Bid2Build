"use server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSalesRep } from "@/lib/sales/server";

/** A rep accepts a compensation amendment. The exact text is hashed so the record proves what was accepted. */
export async function acceptAmendment(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = String(fd.get("id") ?? "").slice(0, 40);
  const typed = String(fd.get("typed_name") ?? "").trim().slice(0, 120);
  const { data } = await db.rpc("sales_my_amendments");
  const a = ((data ?? []) as { id: string; body: string; accepted_at: string | null }[]).find((x) => x.id === id);
  if (!a || fd.get("agree") !== "on" || typed.length < 2) redirect(`/sales/amendments?err=agree`);
  const h = await headers();
  const { error } = await db.rpc("sales_my_amendment_accept", {
    p_id: a.id, p_body_sha256: createHash("sha256").update(a.body, "utf8").digest("hex"), p_typed_name: typed,
    p_ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null, p_user_agent: (h.get("user-agent") ?? "").slice(0, 300),
  });
  revalidatePath("/sales");
  redirect(error ? "/sales/amendments?err=save" : "/sales/amendments?ok=1");
}
