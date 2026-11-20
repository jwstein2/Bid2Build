import type { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { FREE_SAVED_ITEMS_LIMIT, libraryOpSchema, savedItemSchema, usageCounts, usesFor, type LibraryData, type SavedItem, type StackScale } from "@/lib/library/saved-items";

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
type Supa = Awaited<ReturnType<typeof createClient>>;

/** Server-side entitlement (Unlimited or admin). RLS enforces the same rule on every write. */
const hasAccess = (supabase: Supa) => hasPremiumAccess(supabase);
/** Saved Items for every plan (V8 batch 5): true once SQL 20270106001000 has been run. */
const freeItemsOk = async (supabase: Supa) => (await supabase.rpc("saved_items_free_ok")).data === true;
const FREE_LIMIT_MESSAGE = `Free accounts can keep up to ${FREE_SAVED_ITEMS_LIMIT} saved items. Individual Unlimited has no limit, and everything you've saved comes with you.`;

const mapItem = (r: any): SavedItem => ({
  id: r.id, name: r.name, description: r.description ?? undefined, trade: r.trade ?? null, category: r.category ?? undefined,
  costType: r.cost_type ?? "material", treatment: r.treatment ?? "marked_up", quantity: r.quantity === null || r.quantity === undefined ? undefined : num(r.quantity),
  unit: r.unit ?? "each", unitCost: num(r.unit_cost), taxable: r.taxable ?? true,
  // Price-source metadata (V5). Absent until migration 20261127001000 is applied.
  supplierName: r.supplier_name ?? null, supplierSku: r.supplier_sku ?? null, priceSource: r.price_source ?? null,
  priceEffectiveOn: r.price_effective_on ? String(r.price_effective_on).slice(0, 10) : null,
});

/**
 * The signed-in contractor's Saved Items and Saved Stacks. Without Unlimited, Saved Items are still
 * returned and editable (V8 batch 5, once its SQL ran); Saved Stacks stay in the database (nothing is
 * deleted) but are not returned for reuse: the response only says how many are kept.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  if (!(await hasAccess(supabase))) {
    if (await freeItemsOk(supabase)) {
      const [{ data: items }, { count: stacks }, { data: recent }] = await Promise.all([
        supabase.from("saved_items").select("*").order("name").limit(2000),
        supabase.from("assemblies").select("id", { count: "exact", head: true }),
        supabase.from("estimate_items").select("name").eq("user_id", user.id).order("id").limit(5000),
      ]);
      const counts = usageCounts((recent ?? []).map((r: any) => r.name));
      return json({ access: false, itemsAccess: true, lockedCount: stacks ?? 0, items: (items ?? []).map((r: any) => ({ ...mapItem(r), uses: usesFor(counts, r.name) })), stacks: [] } satisfies LibraryData);
    }
    const [{ count: a }, { count: b }] = await Promise.all([
      supabase.from("saved_items").select("id", { count: "exact", head: true }),
      supabase.from("assemblies").select("id", { count: "exact", head: true }),
    ]);
    return json({ access: false, itemsAccess: false, lockedCount: (a ?? 0) + (b ?? 0), items: [], stacks: [] } satisfies LibraryData);
  }
  const [{ data: items }, { data: asm }, { data: asmItems }, { data: recent }, { data: profile }, { data: favs }, { data: companyId }] = await Promise.all([
    supabase.from("saved_items").select("*").order("name").limit(2000),
    supabase.from("assemblies").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("assembly_items").select("*").order("sort_order").limit(10000),
    // "Frequently used first": names on up to 5,000 of the contractor's own estimate rows (read only).
    supabase.from("estimate_items").select("name").eq("user_id", user.id).order("id").limit(5000),
    // Errors (column not there yet) leave the target unset.
    supabase.from("business_profiles").select("target_margin_pct").eq("user_id", user.id).maybeSingle(),
    // Favorites and company templates (V6 P1-D). Errors before migration 20261130301000 leave them empty.
    supabase.from("library_favorites").select("saved_item_id, assembly_id").limit(5000),
    supabase.rpc("my_company_id"),
  ]);
  const canShare = companyId ? (await supabase.rpc("has_company_permission", { p_company_id: companyId, p_permission: "manage_company_pricing" })).data === true : false;
  const favItems = new Set((favs ?? []).map((f: any) => f.saved_item_id).filter(Boolean));
  const favStacks = new Set((favs ?? []).map((f: any) => f.assembly_id).filter(Boolean));
  const counts = usageCounts((recent ?? []).map((r: any) => r.name));
  return json({
    access: true,
    itemsAccess: true,
    lockedCount: 0,
    targetMarginPct: (profile as any)?.target_margin_pct === null || (profile as any)?.target_margin_pct === undefined ? null : num((profile as any).target_margin_pct),
    canShare,
    items: (items ?? []).map((r: any) => ({ ...mapItem(r), uses: usesFor(counts, r.name), favorite: favItems.has(r.id) })),
    stacks: (asm ?? []).map((a: any) => ({
      id: a.id, name: a.name, trade: a.trade ?? null,
      favorite: favStacks.has(a.id),
      scale: a.scale_unit ? ({ unit: a.scale_unit, label: a.scale_label ?? "Measure", calc: a.scale_calc ?? null } as StackScale) : null,
      company: Boolean(a.company_id), canEdit: a.company_id ? canShare && a.company_id === companyId : a.user_id === user.id,
      starterKey: a.starter_key ?? null,
      items: (asmItems ?? []).filter((i: any) => i.assembly_id === a.id).map((i: any) => ({
        ...mapItem(i), quantity: num(i.quantity),
        per: i.qty_per === null || i.qty_per === undefined ? undefined : num(i.qty_per),
        wastePct: i.waste_pct ? num(i.waste_pct) : undefined, roundUp: i.round_up === true || undefined,
      })),
    })),
  } satisfies LibraryData);
}

const itemRow = (i: z.infer<typeof savedItemSchema>) => ({
  name: i.name, description: i.description?.trim() || null, trade: i.trade || null, category: i.category?.trim() || null,
  cost_type: i.costType, treatment: i.treatment, quantity: i.quantity ? i.quantity : null, unit: i.unit,
  unit_cost: i.unitCost === "" ? null : i.unitCost, taxable: i.taxable,
});
/** Stack rows: assembly_items has no trade or category columns (the stack carries the trade), so sending them fails the insert. */
const stackItemRow = (i: z.infer<typeof savedItemSchema>) => {
  const { trade: _trade, category: _category, ...row } = itemRow(i);
  void _trade; void _category;
  return row;
};

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const parsed = libraryOpSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Check the highlighted fields.", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) });
  const supabase = await createClient();
  const o = parsed.data;
  // Removing your own entries is always allowed (your data, any plan). Saving and editing your own
  // Saved Items is allowed on every plan (V8 batch 5); everything else needs Unlimited.
  const freeItemOp = o.kind === "item" && (o.action === "add" || o.action === "update");
  if (o.action !== "remove" && !(await hasAccess(supabase)) && !(freeItemOp && (await freeItemsOk(supabase)))) {
    return fail(402, "premium_required", freeItemOp
      ? "Saved Items are part of Individual Unlimited. Upgrade to save and reuse your pricing."
      : "Saved Stacks and favorites are part of Individual Unlimited. Your saved items stay with you when you upgrade.");
  }

  let error: { message: string } | null = null;
  let affected = 1;
  if (o.kind === "item" && o.action === "add") {
    ({ error } = await supabase.from("saved_items").insert({ id: o.payload.id, user_id: user.id, ...itemRow(o.payload) }));
  } else if (o.kind === "item" && o.action === "update") {
    const r = await supabase.from("saved_items").update(itemRow(o.payload)).eq("id", o.payload.id).select("id");
    error = r.error; affected = r.data?.length ?? 0;
  } else if (o.kind === "item" && o.action === "remove") {
    ({ error } = await supabase.from("saved_items").delete().eq("id", o.payload.id));
  } else if (o.action === "favorite") {
    const col = o.kind === "item" ? "saved_item_id" : "assembly_id";
    if (o.payload.on) {
      // Insert if missing (a double tap that races hits the unique index and is treated as done).
      const { data: have } = await supabase.from("library_favorites").select("id").eq(col, o.payload.id).limit(1);
      if (!have?.length) {
        ({ error } = await supabase.from("library_favorites").insert({ user_id: user.id, [col]: o.payload.id }));
        if (error && /duplicate key/i.test(error.message)) error = null;
      }
    } else {
      ({ error } = await supabase.from("library_favorites").delete().eq(col, o.payload.id));
    }
  } else if (o.kind === "stack" && o.action === "share") {
    const { data: companyId } = await supabase.rpc("my_company_id");
    if (!companyId) return fail(403, "no_company", "Company templates need a Team workspace.");
    const r = await supabase.from("assemblies").update({ company_id: o.payload.on ? companyId : null }).eq("id", o.payload.id).select("id");
    error = r.error; affected = r.data?.length ?? 0;
  } else if (o.kind === "stack" && o.action === "scale") {
    const { scale, items } = o.payload;
    const r = await supabase.from("assemblies").update({ scale_unit: scale?.unit ?? null, scale_label: scale ? scale.label : null, scale_calc: scale?.calc ?? null }).eq("id", o.payload.id).select("id");
    error = r.error; affected = r.data?.length ?? 0;
    for (const i of items) {
      if (error || !affected) break;
      ({ error } = await supabase.from("assembly_items").update({ qty_per: scale && i.per ? i.per : null, waste_pct: (scale && i.wastePct) || 0, round_up: Boolean(scale && i.roundUp) }).eq("id", i.id).eq("assembly_id", o.payload.id));
    }
  } else if (o.kind === "stack" && o.action === "add") {
    const s = o.payload;
    const { data: companyId } = s.company ? await supabase.rpc("my_company_id") : { data: null };
    if (s.company && !companyId) return fail(403, "no_company", "Company templates need a Team workspace.");
    ({ error } = await supabase.from("assemblies").insert({
      id: s.id, user_id: user.id, name: s.name, trade: s.trade || null,
      scale_unit: s.scale?.unit ?? null, scale_label: s.scale ? s.scale.label : null, scale_calc: s.scale?.calc ?? null,
      starter_key: s.starterKey ?? null, ...(companyId ? { company_id: companyId } : {}),
    }));
    if (!error) {
      ({ error } = await supabase.from("assembly_items").insert(s.items.map((i, k) => ({
        // Client ids are kept so the open page can edit the rows right away (scaling) without a reload.
        id: i.id, ...stackItemRow(i), quantity: i.quantity || "1", assembly_id: s.id, user_id: user.id, sort_order: k,
        ...(s.scale ? { qty_per: i.per || null, waste_pct: i.wastePct || 0, round_up: Boolean(i.roundUp) } : {}),
      }))));
      // Don't leave an empty stack behind if its rows were refused.
      if (error) await supabase.from("assemblies").delete().eq("id", s.id);
    }
  } else if (o.kind === "stack" && o.action === "rename") {
    const r = await supabase.from("assemblies").update({ name: o.payload.name }).eq("id", o.payload.id).select("id");
    error = r.error; affected = r.data?.length ?? 0;
  } else if (o.kind === "stack" && o.action === "remove") {
    ({ error } = await supabase.from("assemblies").delete().eq("id", o.payload.id));
  }
  if (error) {
    if (/free_item_limit/i.test(error.message)) return fail(402, "free_item_limit", FREE_LIMIT_MESSAGE);
    if (/company_template_locked/i.test(error.message)) return fail(403, "company_template_locked", "Only people who manage company pricing can change company templates.");
    if (/row-level security/i.test(error.message)) return fail(402, "premium_required", "Saved Items are part of Individual Unlimited. Upgrade to save and reuse your pricing.");
    return fail(500, "save_failed", "Could not update your Saved Items. Please try again.");
  }
  if (!affected) return fail(404, "not_found", "That saved item no longer exists.");
  return json({ ok: true });
}
