import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { suppress } from "./server";

/** Opt the recipient of message `id` out: follow-ups for a nurture email, progress emails for a project update. Idempotent. */
export async function unsubscribeByMessage(admin: SupabaseClient, id: string): Promise<{ ok: boolean; kind?: string; company?: string }> {
  const { data: m } = await admin.from("comm_messages").select("id, account_id, kind, to_email").eq("id", id).maybeSingle();
  const r = m as { id: string; account_id: string; kind: string; to_email: string | null } | null;
  if (!r?.to_email) return { ok: false };
  await suppress(admin, { accountId: r.account_id, email: r.to_email, scope: r.kind === "nurture" ? "marketing" : "project_updates", reason: "unsubscribe", source: "unsubscribe link", messageId: r.id });
  await admin.from("comm_messages").update({ opt_out_at: new Date().toISOString() }).eq("id", r.id).is("opt_out_at", null);
  return { ok: true, kind: r.kind };
}
