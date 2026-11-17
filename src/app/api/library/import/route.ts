import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { MAX_IMPORT_ROWS } from "@/lib/pricing/import";

/* eslint-disable @typescript-eslint/no-explicit-any */
const dec = z.string().trim().max(20).regex(/^\d+(\.\d+)?$/);
const row = z.object({
  savedItemId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(80).optional(),
  unit: z.string().trim().min(1).max(40),
  packSize: dec.optional(),
  unitCost: dec,
  category: z.string().trim().max(120).optional(),
  trade: z.string().max(60).optional(),
});
const opSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply"),
    supplierName: z.string().trim().min(1, "Enter the supplier's name").max(120),
    supplierId: z.string().uuid().optional(),
    fileName: z.string().max(255).optional(),
    effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    rows: z.array(row).min(1, "Pick at least one row").max(MAX_IMPORT_ROWS),
  }),
  z.object({ action: z.literal("undo"), importId: z.string().uuid() }),
  z.object({ action: z.literal("target_margin"), percent: z.string().trim().regex(/^(\d{1,2}(\.\d{1,2})?)?$/, "Enter 0 to 99.99") }),
]);

const MESSAGES: Record<string, [number, string]> = {
  premium_required: [402, "Supplier price imports are part of Unlimited."],
  item_not_found: [409, "A saved item in this file was deleted. Reload the preview and try again."],
  already_undone: [409, "That import was already undone."],
  import_not_found: [404, "That import no longer exists."],
  row_bad_number: [400, "A price in the file isn't a number."],
};

/** Recent supplier imports for the signed-in contractor (newest first). */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("price_imports").select("*").order("created_at", { ascending: false }).limit(20);
  if (error) return json({ imports: [], ready: false });
  return json({
    ready: true,
    imports: (data ?? []).map((r: any) => ({
      id: r.id, supplierName: r.supplier_name, fileName: r.file_name, effectiveOn: String(r.effective_on).slice(0, 10), createdAt: r.created_at,
      created: r.created_count, updated: r.updated_count, unchanged: r.unchanged_count, status: r.status,
      restored: r.restored_count, kept: r.kept_count, supplierId: r.supplier_id ?? null,
    })),
  });
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const parsed = opSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Check the file and try again.");
  const supabase = await createClient();
  const o = parsed.data;

  if (o.action === "target_margin") {
    const v = o.percent === "" ? null : o.percent;
    const { data, error } = await supabase.from("business_profiles").update({ target_margin_pct: v }).eq("user_id", user.id).select("user_id");
    if (!error && !data?.length) {
      const ins = await supabase.from("business_profiles").insert({ user_id: user.id, target_margin_pct: v });
      if (ins.error) return fail(500, "save_failed", "Could not save your target margin.");
    } else if (error) return fail(500, "save_failed", "Could not save your target margin.");
    return json({ ok: true, targetMarginPct: v });
  }

  const { data, error } = o.action === "apply"
    ? await supabase.rpc("price_import_apply", { p: { supplierName: o.supplierName, fileName: o.fileName, effectiveOn: o.effectiveOn, rows: o.rows } })
    : await supabase.rpc("price_import_undo", { p_import_id: o.importId });
  if (error) {
    const code = Object.keys(MESSAGES).find((k) => error.message.includes(k));
    if (code) return fail(MESSAGES[code][0], code, MESSAGES[code][1]);
    return fail(500, "import_failed", "Could not import the price list. Nothing was changed.");
  }
  // Link the import to the supplier directory (the chosen supplier, or one found / added by name).
  // Best effort: the import itself already succeeded, and before the team-records SQL this is a no-op.
  if (o.action === "apply" && (data as { importId?: string } | null)?.importId) {
    const link = await supabase.rpc("price_import_link_supplier", { p_import_id: (data as { importId: string }).importId, p_supplier_id: o.supplierId ?? null });
    if (!link.error && link.data) (data as Record<string, unknown>).supplierId = link.data;
  }
  return json({ ok: true, result: data });
}
