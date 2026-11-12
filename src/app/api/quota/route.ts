import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { data, error } = await (await createClient()).rpc("quota_status");
  if (error) return fail(500, "quota_failed", "Could not load usage.");
  const q = (Array.isArray(data) ? data[0] : data) as { exports_used: number; export_limit: number; unlimited: boolean; resets_at: string };
  return json({ used: q.exports_used, limit: q.export_limit, unlimited: q.unlimited, resetsAt: q.resets_at, emailVerified: user.emailVerified });
}
