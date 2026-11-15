"use server";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { giftClaimMessage } from "@/lib/creator/program";
import { hashInviteToken, isTokenShape } from "@/lib/creator/server";
import { rateLimit } from "@/lib/http/api";

/** Claim with the signed-in account. All checks (verified email match, capacity, expiry, replay) run in Postgres. */
export async function acceptGift(token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };
  if (!(await rateLimit(`gift-claim:${user.id}`, 10, 10 * 60_000))) return { ok: false, message: "Too many attempts. Try again in a few minutes." };
  if (!isTokenShape(token)) return { ok: false, message: giftClaimMessage("invalid") };
  const { data, error } = await createAdminClient().rpc("claim_creator_gift", { p_user_id: user.id, p_token_hash: hashInviteToken(token) });
  const r = (data ?? {}) as { ok?: boolean; reason?: string; hint?: string };
  if (error || !r.ok) return { ok: false, message: giftClaimMessage(r.reason, r.hint) };
  return { ok: true };
}
