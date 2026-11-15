"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/admin/server";

/**
 * Owner classification of an account as genuine / internal / test / demo (or back to automatic).
 * Reporting only: it never changes the account, its entitlements, subscriptions or saved data.
 */
const Input = z.object({ id: z.string().uuid(), label: z.enum(["auto", "genuine", "internal", "test", "demo"]), note: z.string().trim().max(300).optional() });

export async function setAccountLabel(form: FormData) {
  const { user, db } = await requireAdmin();
  const p = Input.safeParse({ id: form.get("id"), label: form.get("label"), note: form.get("note") || undefined });
  if (!p.success) redirect("/admin/customers");
  const { id, label, note } = p.data;
  const back = `/admin/customers/${id}`;
  const { data: existing, error: readErr } = await db.from("admin_account_labels").select("label").eq("user_id", id).maybeSingle();
  if (readErr) redirect(`${back}?label_error=${encodeURIComponent("Run migration 20261115002000_admin_reporting.sql first.")}`);
  await audit(db, user.id, "account_label.set", "user", id, { from: (existing as { label?: string } | null)?.label ?? "auto", to: label });
  const { error } = label === "auto"
    ? await db.from("admin_account_labels").delete().eq("user_id", id)
    : await db.from("admin_account_labels").upsert({ user_id: id, label, note: note ?? null, set_by: user.id }, { onConflict: "user_id" });
  if (error) redirect(`${back}?label_error=${encodeURIComponent("Could not save the label.")}`);
  revalidatePath("/admin", "layout");
  redirect(`${back}?label_saved=1`);
}
