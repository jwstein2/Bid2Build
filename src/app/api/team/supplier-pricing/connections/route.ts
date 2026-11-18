import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, guardWrite } from "@/lib/team/route-helpers";
import { mapConnections, PROVIDER_IDS } from "@/lib/pricing/providers";

export const runtime = "nodejs";

const ref = z.string().trim().max(80).nullish();
const body = z.object({
  provider: z.enum(PROVIDER_IDS),
  supplierId: z.string().uuid().nullish(),
  accountRef: ref,
  branchRef: ref,
  useForCrossCheck: z.boolean().optional(),
  paused: z.boolean().optional(),
});

/** The company's (or solo account's) opted-in pricing sources. */
export async function GET() {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { data, error } = await g.supabase.rpc("supplier_connections_list");
  if (error) return dbFail("supplier-pricing.connections", error);
  return json(mapConnections(data));
}

/** Opt in to, update, or pause a pricing source. Stores only account/branch references, never passwords. */
export async function POST(req: Request) {
  const g = await guardWrite("supplier-connection", 60);
  if (!g.ok) return g.res;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the details and try again.");
  const { error } = await g.supabase.rpc("supplier_connection_save", { p: p.data });
  if (error) return dbFail("supplier-pricing.save", error);
  return json({ ok: true });
}

/** Withdraw consent: removes the connection and its account reference. */
export async function DELETE(req: Request) {
  const g = await guardWrite("supplier-connection", 60);
  if (!g.ok) return g.res;
  const provider = z.enum(PROVIDER_IDS).safeParse(new URL(req.url).searchParams.get("provider"));
  if (!provider.success) return fail(400, "invalid", "Unknown pricing source.");
  const { error } = await g.supabase.rpc("supplier_connection_remove", { p_provider: provider.data });
  if (error) return dbFail("supplier-pricing.remove", error);
  return json({ ok: true });
}
