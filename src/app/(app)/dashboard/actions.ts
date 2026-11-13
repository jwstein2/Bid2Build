"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadEstimate } from "@/lib/data/server";

const id = z.string().uuid();

async function ctx() {
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard");
  return { user, supabase: await createClient() };
}

export async function renameEstimate(estimateId: string, title: string) {
  const { supabase } = await ctx();
  if (!id.safeParse(estimateId).success) return;
  await supabase.from("estimates").update({ title: title.slice(0, 300) }).eq("id", estimateId);
  revalidatePath("/dashboard");
}

export async function setArchived(estimateId: string, archived: boolean) {
  const { supabase } = await ctx();
  if (!id.safeParse(estimateId).success) return;
  const { data: v } = await supabase.from("estimate_versions").select("id").eq("estimate_id", estimateId).limit(1);
  await supabase.from("estimates").update({ status: archived ? "archived" : v?.length ? "finalized" : "draft" }).eq("id", estimateId);
  revalidatePath("/dashboard");
}

export async function deleteEstimate(estimateId: string) {
  const { supabase } = await ctx();
  if (!id.safeParse(estimateId).success) return;
  await supabase.from("estimates").delete().eq("id", estimateId);
  revalidatePath("/dashboard");
}

export async function duplicateEstimate(estimateId: string) {
  const { supabase } = await ctx();
  if (!id.safeParse(estimateId).success) return;
  const data = await loadEstimate(supabase, estimateId);
  if (!data) return;
  const groupMap = new Map(data.estimate.groups.map((g) => [g.id, crypto.randomUUID()]));
  const itemMap = new Map(data.estimate.items.map((i) => [i.id, crypto.randomUUID()]));
  // Carry saved calculator inputs over to the copied line items.
  const calcs = Object.fromEntries(Object.entries(data.estimate.worksheet?.calcs ?? {}).filter(([k]) => itemMap.has(k)).map(([k, v]) => [itemMap.get(k)!, v]));
  const worksheet = data.estimate.worksheet ? { ...data.estimate.worksheet, calcs } : undefined;
  const copy = {
    ...data.estimate,
    id: crypto.randomUUID(),
    title: `${data.estimate.title} (copy)`.slice(0, 300),
    status: "draft" as const,
    estimateDate: new Date().toISOString().slice(0, 10),
    groups: data.estimate.groups.map((g) => ({ ...g, id: groupMap.get(g.id)! })),
    items: data.estimate.items.map((i) => ({ ...i, id: itemMap.get(i.id)!, groupId: groupMap.get(i.groupId)! })),
    worksheet: undefined,
    proposalConfig: { ...data.proposalConfig, worksheet },
  };
  const { error } = await supabase.rpc("save_estimate", { p: copy });
  if (!error) redirect(`/estimates/${copy.id}`);
}
