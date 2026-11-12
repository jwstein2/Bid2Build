import { createClient, getUser } from "@/lib/supabase/server";
import { loadCreditStatus } from "@/lib/credits/server";
import { fail, json } from "@/lib/http/api";

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const credits = await loadCreditStatus(await createClient());
  if (!credits) return fail(500, "credits_failed", "Could not load your bid credits.");
  return json(credits);
}
