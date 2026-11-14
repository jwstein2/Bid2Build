import type { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { libraryOpSchema, savedItemSchema, type LibraryData, type SavedItem } from "@/lib/library/saved-items";

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
type Supa = Awaited<ReturnType<typeof createClient>>;

/** Server-side entitlement (Unlimited or admin). RLS enforces the same rule on every write. */
const hasAccess = (supabase: Supa) => hasPremiumAccess(supabase);

const mapItem = (r: any): SavedItem => ({
  id: r.id, name: r.name, description: r.description ?? undefined, trade: r.trade ?? null, category: r.category ?? undefined,
  costType: r.cost_type ?? "material", treatment: r.treatment ?? "marked_up", quantity: r.quantity === null || r.quantity === undefined ? undefined : num(r.quantity),
  unit: r.unit ?? "each", unitCost: num(r.unit_cost), taxable: r.taxable ?? true,
});

/**
 * The signed-in contractor's Saved Items and Saved Stacks. Without an active Unlimited subscription
 * the entries stay in the database (nothing is deleted) but are not returned for reuse: the response
 * only says how many are kept.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  if (!(await hasAccess(supabase))) {
    const [{ count: a }, { count: b }] = await Promise.all([
      supabase.from("saved_items").select("id", { count: "exact", head: true }),
      supabase.from("assemblies").select("id", { count: "exact", head: true }),
    ]);
    return json({ access: false, lockedCount: (a ?? 0) + (b ?? 0), items: [], stacks: [] } satisfies LibraryData);
  }
  const [{ data: items }, { data: asm }, { data: asmItems }] = await Promise.all([
    supabase.from("saved_items").select("*").order("name").limit(2000),
    supabase.from("assemblies").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("assembly_items").select("*").order("sort_order").limit(10000),
  ]);
  return json({
    access: true,
    lockedCount: 0,
    items: (items ?? []).map(mapItem),
    stacks: (asm ?? []).map((a: any) => ({
      id: a.id, name: a.name, trade: a.trade ?? null,
      items: (asmItems ?? []).filter((i: any) => i.assembly_id === a.id).map((i: any) => ({ ...mapItem(i), quantity: num(i.quantity) })),
    })),
  } satisfies LibraryData);
}

const itemRow = (i: z.infer<typeof savedItemSchema>) => ({
  name: i.name, description: i.description?.trim() || null, trade: i.trade || null, category: i.category?.trim() || null,
  cost_type: i.costType, treatment: i.treatment, quantity: i.quantity ? i.quantity : null, unit: i.unit,
  unit_cost: i.unitCost === "" ? null : i.unitCost, taxable: i.taxable,
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const parsed = libraryOpSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Check the highlighted fields.", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) });
  const supabase = await createClient();
  const o = parsed.data;
  // Removing your own entries is always allowed (your data, any plan). Creating or changing needs Unlimited.
  if (o.action !== "remove" && !(await hasAccess(supabase))) {
    return fail(402, "premium_required", "Saved Items are part of Unlimited. Upgrade to save and reuse your pricing.");
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
  } else if (o.kind === "stack" && o.action === "add") {
    const s = o.payload;
    ({ error } = await supabase.from("assemblies").insert({ id: s.id, user_id: user.id, name: s.name, trade: s.trade || null }));
    if (!error) {
      ({ error } = await supabase.from("assembly_items").insert(s.items.map((i, k) => ({ ...itemRow(i), quantity: i.quantity || "1", assembly_id: s.id, user_id: user.id, sort_order: k }))));
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
    if (/row-level security/i.test(error.message)) return fail(402, "premium_required", "Saved Items are part of Unlimited. Upgrade to save and reuse your pricing.");
    return fail(500, "save_failed", "Could not update your Saved Items. Please try again.");
  }
  if (!affected) return fail(404, "not_found", "That saved item no longer exists.");
  return json({ ok: true });
}
