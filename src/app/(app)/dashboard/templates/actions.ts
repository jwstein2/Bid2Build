"use server";
import { revalidatePath } from "next/cache";
import { proposalConfigSchema } from "@/lib/estimate/schema";
import { createClient, getUser } from "@/lib/supabase/server";

export type SaveDefaultsResult = { ok: true } | { ok: false; message: string };

export async function saveProposalDefaults(config: unknown): Promise<SaveDefaultsResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in again to save." };
  const parsed = proposalConfigSchema.safeParse(config);
  if (!parsed.success) return { ok: false, message: "Some settings are invalid." };
  const supabase = await createClient();
  const { data: q } = await supabase.rpc("quota_status");
  const unlimited = Boolean((Array.isArray(q) ? q[0] : q)?.unlimited);
  if (!unlimited) return { ok: false, message: "Saved proposal defaults are part of Unlimited." };
  const { error } = await supabase.from("business_profiles").upsert({ user_id: user.id, default_proposal_config: parsed.data }, { onConflict: "user_id" });
  if (error) return { ok: false, message: "Could not save. Try again." };
  revalidatePath("/dashboard/templates");
  return { ok: true };
}
