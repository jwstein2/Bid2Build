"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const s = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const back = (q: Record<string, string>): never => { revalidatePath("/affiliate-hub/profile"); redirect(`/affiliate-hub/profile?${new URLSearchParams(q)}`); };

export async function openDispute(fd: FormData) {
  const d = s(fd, "description", 2000);
  if (d.length < 10) back({ err: "dispute" });
  const { error } = await (await createClient()).rpc("affiliate_my_dispute", { p_kind: s(fd, "kind", 20), p_customer_hint: s(fd, "customer"), p_description: d });
  back(error ? { err: "dispute" } : { ok: "dispute" });
}
