import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";

const body = z.object({ keepId: z.string().uuid(), removeId: z.string().uuid() });

/** Merge two customer records the contractor confirmed are the same customer (never automatic). */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success || p.data.keepId === p.data.removeId) return fail(400, "invalid", "Choose two different customers.");
  const { error } = await (await createClient()).rpc("customer_merge", { p_keep: p.data.keepId, p_remove: p.data.removeId });
  if (error) {
    if (error.code === "42501") return fail(403, "forbidden", "You can only merge customers you're allowed to edit, in the same account.");
    logError("customers.merge", error, { user: user.id });
    return fail(500, "merge_failed", "Could not merge these customers.");
  }
  return json({ ok: true });
}
