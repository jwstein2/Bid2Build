import { z } from "zod";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { getStripe } from "@/lib/billing/stripe";
import { isStripeConfigured } from "@/lib/env";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = z.object({ confirm: z.literal("DELETE") }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Type DELETE to confirm.");
  const admin = createAdminClient();
  try {
    if (isStripeConfigured()) {
      const { data: subs } = await admin.from("subscriptions").select("stripe_subscription_id, status").eq("user_id", user.id);
      for (const s of subs ?? []) if (!["canceled", "incomplete_expired"].includes(s.status)) await getStripe().subscriptions.cancel(s.stripe_subscription_id);
    }
    for (const bucket of ["logos", "documents"]) {
      const { data: files } = await admin.storage.from(bucket).list(user.id, { limit: 1000 });
      const paths: string[] = [];
      for (const f of files ?? []) {
        if (f.id) paths.push(`${user.id}/${f.name}`);
        else {
          const { data: nested } = await admin.storage.from(bucket).list(`${user.id}/${f.name}`, { limit: 1000 });
          for (const n of nested ?? []) paths.push(`${user.id}/${f.name}/${n.name}`);
        }
      }
      if (paths.length) await admin.storage.from(bucket).remove(paths);
    }
    await admin.from("audit_logs").insert({ actor_id: null, action: "account.deleted", target_type: "user", target_id: user.id });
    const { error } = await admin.auth.admin.deleteUser(user.id); // cascades to all user-owned rows
    if (error) throw error;
    await (await createClient()).auth.signOut();
    return json({ ok: true });
  } catch (e) {
    logError("account.delete", e, { user: user.id });
    return fail(500, "delete_failed", "We couldn't delete your account. Please contact support.");
  }
}
