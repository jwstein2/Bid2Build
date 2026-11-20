"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { inviteTokenHash } from "@/lib/affiliates/server";

export async function acceptInvite(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) redirect("/affiliate-hub");
  const { error } = await (await createClient()).rpc("affiliate_invite_accept", { p_token_hash: inviteTokenHash(token) });
  if (error) redirect(`/affiliate-hub/invite/${token}?err=${/wrong_email/.test(error.message) ? "wrong_email" : "invalid"}`);
  redirect("/affiliate-hub/onboarding");
}
