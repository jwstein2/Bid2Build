"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/server";

/**
 * Save the weekly lead import's target from the Sales Hub (Leads tab): a state region (for example
 * Southeast Minnesota) or a ZIP + radius. Both database functions check the caller is a sales admin and
 * write the audit log. Kept apart from the Hub page's own actions so the form works wherever the Hub lives.
 */
const HUB_PATHS = ["/admin/sales-hub", "/sales/admin"];

function back(path: string, result: { ok?: string; err?: string }): never {
  const q = new URLSearchParams({ tab: "leads", ...result });
  revalidatePath(path);
  redirect(`${path}?${q.toString()}`);
}

export async function saveLeadTargetForm(fd: FormData) {
  const { user, db } = await requireAdmin();
  const path = HUB_PATHS.includes(String(fd.get("back"))) ? String(fd.get("back")) : HUB_PATHS[0];
  const trade = String(fd.get("trade") ?? "").slice(0, 40) || null;
  const count = Number(fd.get("count")) || 50;
  const paused = fd.get("paused") === "on";
  if (fd.get("mode") === "region") {
    const [state, region] = String(fd.get("region") ?? "").split(":");
    if (!state || !region) back(path, { err: "invalid_region" });
    const { error } = await db.rpc("admin_sales_import_target_save_region", {
      p_caller: user.id, p_state: state, p_region: region, p_trade: trade, p_count: count, p_paused: paused, p_restart: fd.get("restart") === "on",
    });
    if (error) back(path, { err: /invalid_region/.test(error.message) ? "invalid_region" : "invalid" });
    back(path, { ok: fd.get("restart") === "on" ? "Saved. The next weekly run starts this region from the top of the list." : "Saved. The next weekly run will use this region and pick up where the last run stopped." });
  }
  const zip = String(fd.get("zip") ?? "").trim();
  if (!/^\d{5}$/.test(zip)) back(path, { err: "invalid_zip" });
  const { error } = await db.rpc("admin_sales_import_target_save", {
    p_caller: user.id, p_zip: zip, p_trade: trade, p_radius: Number(fd.get("radius")) || 50, p_count: count, p_paused: paused,
  });
  if (error) back(path, { err: /invalid_zip/.test(error.message) ? "invalid_zip" : "invalid" });
  back(path, { ok: "Saved. The next weekly run will use this ZIP and radius." });
}
