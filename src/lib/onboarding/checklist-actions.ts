"use server";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import { CHECKLIST_DISMISSED_KEY } from "@/lib/growth/activation";
import { CHECKLIST_META_KEY } from "./checklist";

/** Hide (or bring back) the Home getting started card for this person. Stored on their own login. */
export async function setChecklistHidden(hidden: boolean) {
  const user = await getUser();
  if (!user) return;
  const db = await createClient();
  const at = hidden ? new Date().toISOString() : null;
  // Both checklists share one switch, so bringing it back shows the Home card again.
  await db.auth.updateUser({ data: { [CHECKLIST_META_KEY]: at, [CHECKLIST_DISMISSED_KEY]: at } });
  revalidatePath("/home");
  revalidatePath("/dashboard");
}
