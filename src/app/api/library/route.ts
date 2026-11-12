import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, sameOrigin } from "@/lib/http/api";

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const [{ data: items }, { data: asm }, { data: asmItems }] = await Promise.all([
    supabase.from("saved_items").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("assemblies").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("assembly_items").select("*").order("sort_order"),
  ]);
  const mapItem = (r: any) => ({ id: r.id, name: r.name, description: r.description ?? undefined, costType: r.cost_type, treatment: r.treatment, unit: r.unit, unitCost: num(r.unit_cost), taxable: r.taxable });
  return json({
    items: (items ?? []).map(mapItem),
    assemblies: (asm ?? []).map((a: any) => ({ id: a.id, name: a.name, items: (asmItems ?? []).filter((i: any) => i.assembly_id === a.id).map((i: any) => ({ ...mapItem(i), quantity: num(i.quantity) })) })),
  });
}

const dec = z.string().max(20).regex(/^\d*(\.\d*)?$/).or(z.literal(""));
const savedItem = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(300), description: z.string().max(4000).optional(),
  costType: z.string().max(30), treatment: z.enum(["marked_up", "pass_through"]), unit: z.string().max(40), unitCost: dec, taxable: z.boolean(),
});
const op = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item"), action: z.literal("add"), payload: savedItem }),
  z.object({ kind: z.literal("item"), action: z.literal("remove"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({ kind: z.literal("assembly"), action: z.literal("add"), payload: z.object({ id: z.string().uuid(), name: z.string().min(1).max(200), items: z.array(savedItem.extend({ quantity: dec })).max(200) }) }),
  z.object({ kind: z.literal("assembly"), action: z.literal("remove"), payload: z.object({ id: z.string().uuid() }) }),
]);

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const parsed = op.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Invalid request.");
  const supabase = await createClient();
  const o = parsed.data;
  const row = (i: z.infer<typeof savedItem>) => ({ name: i.name, description: i.description ?? null, cost_type: i.costType, treatment: i.treatment, unit: i.unit, unit_cost: i.unitCost === "" ? null : i.unitCost, taxable: i.taxable, user_id: user.id });
  let error;
  if (o.kind === "item" && o.action === "add") ({ error } = await supabase.from("saved_items").insert({ id: o.payload.id, ...row(o.payload) }));
  else if (o.kind === "item" && o.action === "remove") ({ error } = await supabase.from("saved_items").delete().eq("id", o.payload.id));
  else if (o.kind === "assembly" && o.action === "add") {
    ({ error } = await supabase.from("assemblies").insert({ id: o.payload.id, name: o.payload.name, user_id: user.id }));
    if (!error && o.payload.items.length) {
      ({ error } = await supabase.from("assembly_items").insert(o.payload.items.map((i, k) => ({ ...row(i), assembly_id: o.payload.id, quantity: i.quantity || "1", sort_order: k }))));
    }
  } else if (o.kind === "assembly" && o.action === "remove") ({ error } = await supabase.from("assemblies").delete().eq("id", o.payload.id));
  if (error) return fail(500, "save_failed", "Could not update your library.");
  return json({ ok: true });
}
