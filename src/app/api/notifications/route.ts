import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { missingMigration } from "@/lib/operations/server";

export const runtime = "nodejs";

/** In-app task review notices for the signed-in project manager (synced on read; no cron). */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { data, error } = await (await createClient()).rpc("my_notifications");
  if (error) {
    if (missingMigration(error)) return json({ available: false, items: [] });
    logError("notifications.list", error);
    return fail(500, "server_error", "We couldn't load notices.");
  }
  return json({ available: true, items: data ?? [] });
}
