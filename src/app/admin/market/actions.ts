"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/server";
import { generateSyntheticDataset } from "@/lib/market/synthetic";

const REVIEW = ["genuine_premium", "complex_scope", "data_entry_error", "unit_conversion_error", "insufficient_data", "needs_investigation", "open"] as const;

export async function refreshMarket() {
  const { user, db } = await requireAdmin();
  await db.rpc("market_refresh", { p_caller: user.id });
  revalidatePath("/admin/market", "layout");
}

export async function reviewAnomaly(id: number, form: FormData) {
  const { user, db } = await requireAdmin();
  const status = z.enum(REVIEW).safeParse(form.get("status"));
  if (!status.success || !Number.isInteger(id)) return;
  const note = String(form.get("note") ?? "").slice(0, 1000) || null;
  await db.rpc("market_review_anomaly", { p_caller: user.id, p_id: id, p_status: status.data, p_note: note });
  revalidatePath("/admin/market/anomalies");
}

const patch = z.object({
  component: z.string().max(40).optional(), material: z.string().max(40).optional(), category: z.string().max(80).optional(),
  brand: z.string().max(60).optional(), product_line: z.string().max(60).optional(),
  cost_class: z.enum(["labor", "material", "equipment", "subcontractor", "other"]).optional(), material_key: z.string().max(200).optional(),
});

export async function updateClassification(fingerprint: string, form: FormData) {
  const { user, db } = await requireAdmin();
  const p = patch.safeParse(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v).trim()])));
  if (!p.success || fingerprint.length > 240) return;
  await db.rpc("market_update_classification", { p_caller: user.id, p_fingerprint: fingerprint, p_patch: p.data });
  revalidatePath("/admin/market/classifications");
}

export async function mergeClassifications(form: FormData) {
  const { user, db } = await requireAdmin();
  const fps = form.getAll("fp").map(String).filter((f) => f.length <= 240).slice(0, 100);
  const key = String(form.get("material_key") ?? "").trim().slice(0, 200);
  const category = String(form.get("category") ?? "").trim().slice(0, 80);
  if (fps.length < 2 || !key || !category) return;
  await db.rpc("market_merge_classifications", { p_caller: user.id, p_fingerprints: fps, p_material_key: key, p_category: category });
  revalidatePath("/admin/market/classifications");
}

const settings = z.object({
  min_contributors: z.coerce.number().int().min(20).max(1000), zip_min_contributors: z.coerce.number().int().min(20).max(1000),
  precise_confidence: z.coerce.number().min(0.5).max(1), anomaly_z: z.coerce.number().min(1).max(20), iqr_k: z.coerce.number().min(0.5).max(20),
  min_peer_observations: z.coerce.number().int().min(3).max(1000), min_peer_contributors: z.coerce.number().int().min(2).max(1000),
  peer_window_months: z.coerce.number().int().min(1).max(120), margin_high_pct: z.coerce.number().min(10).max(99), retention_months: z.coerce.number().int().min(12).max(600),
});

export async function saveSettings(form: FormData) {
  const { user, db } = await requireAdmin();
  const p = settings.safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return;
  await db.rpc("market_update_settings", { p_caller: user.id, p: p.data });
  revalidatePath("/admin/market/settings");
}

export async function seedSynthetic() {
  const { user, db } = await requireAdmin();
  await db.rpc("market_clear_synthetic", { p_caller: user.id });
  await db.rpc("market_seed_synthetic", { p_caller: user.id, p_rows: generateSyntheticDataset() });
  await db.rpc("market_refresh", { p_caller: user.id });
  revalidatePath("/admin/market", "layout");
}

export async function clearSynthetic() {
  const { user, db } = await requireAdmin();
  await db.rpc("market_clear_synthetic", { p_caller: user.id });
  revalidatePath("/admin/market", "layout");
}
