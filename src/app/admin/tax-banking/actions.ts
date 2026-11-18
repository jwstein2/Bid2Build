"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/server";
import { STATE_CODES } from "@/lib/tax-banking/authorities";
import { runOfficialImports } from "@/lib/tax-banking/tax/importer";

/**
 * Owner-only: point a state at its official rate files, and import one state now. Public rate data only; no
 * customer data. Each action re-authorizes with requireAdmin().
 */
const link = z.string().trim().url().startsWith("https://").max(500).or(z.literal(""));
const Input = z.object({ state: z.string().refine((s) => STATE_CODES.includes(s)), listingUrl: link, rateUrl: link, boundaryUrl: link });

export async function saveSourceLinks(form: FormData): Promise<void> {
  const { db } = await requireAdmin();
  const p = Input.safeParse({ state: form.get("state"), listingUrl: form.get("listingUrl") ?? "", rateUrl: form.get("rateUrl") ?? "", boundaryUrl: form.get("boundaryUrl") ?? "" });
  if (!p.success) return;
  await db.from("tax_rate_sources").update({ listing_url: p.data.listingUrl || null, rate_url: p.data.rateUrl || null, boundary_url: p.data.boundaryUrl || null,
    status: "needs_link", last_attempt_at: null, updated_at: new Date().toISOString() }).eq("state", p.data.state);
  revalidatePath("/admin/tax-banking");
}

export async function importStateNow(form: FormData): Promise<void> {
  const { db } = await requireAdmin();
  const state = String(form.get("state") ?? "");
  if (!STATE_CODES.includes(state)) return;
  await runOfficialImports(db, { states: [state], budgetMs: 40_000 });
  revalidatePath("/admin/tax-banking");
}
