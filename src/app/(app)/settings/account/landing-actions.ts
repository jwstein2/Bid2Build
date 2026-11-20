"use server";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import type { Landing } from "@/lib/workspaces";

/** Saves where sign-in opens (V8.10). Only remembers a choice; /auth/landing still checks access. */
export async function saveLanding(form: FormData): Promise<void> {
  const v = String(form.get("landing") ?? "");
  if (!(["auto", "contractor", "sales"] as Landing[]).includes(v as Landing)) return;
  if (!(await getUser())) return;
  const db = await createClient();
  await db.rpc("set_my_workspace", { p_landing: v });
  revalidatePath("/settings/account");
}
