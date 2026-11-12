import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, sameOrigin } from "@/lib/http/api";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = z.object({ optIn: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  await (await createClient()).from("profiles").update({ marketing_opt_in: p.data.optIn, marketing_opt_in_at: p.data.optIn ? new Date().toISOString() : null }).eq("id", user.id);
  return json({ ok: true });
}
