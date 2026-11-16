import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";

export interface CoContent {
  number: number; title: string; description: string | null; version: number; amount: number;
  lines: { kind: "add" | "remove" | "modify"; description: string; amount: number }[];
  scheduleDays: number | null; customerNotes: string | null;
  project: { title: string; number: string; customerName: string | null; projectAddress: string | null };
}
export interface CoRequest {
  id: string; phase: "pending" | "signed" | "expired" | "revoked"; expiresAt: string; content: CoContent; companyName: string; contact: string;
  signature: { signerName: string; signedAt: string } | null;
}

/** Load a change-order signing link by its secret token (service role; only frozen customer content). */
export async function loadCoRequest(admin: SupabaseClient, token: string): Promise<CoRequest | null> {
  if (!isSigningToken(token)) return null;
  const { data: r } = await admin.from("change_order_signing").select("id, status, expires_at, change_order_id, version_id").eq("token_hash", hashSigningToken(token)).maybeSingle();
  if (!r) return null;
  const [{ data: v }, { data: co }, { data: sig }] = await Promise.all([
    admin.from("change_order_versions").select("content").eq("id", r.version_id).maybeSingle(),
    admin.from("change_orders").select("user_id, status, version").eq("id", r.change_order_id).maybeSingle(),
    admin.from("change_order_signatures").select("signer_name, signed_at").eq("request_id", r.id).maybeSingle(),
  ]);
  if (!v || !co) return null;
  const { data: biz } = await admin.from("business_profiles").select("company_name, phone, email").eq("user_id", co.user_id).maybeSingle();
  const content = v.content as CoContent;
  const phase: CoRequest["phase"] = r.status === "signed" ? "signed" : r.status === "revoked" || co.status !== "sent" || co.version !== content.version ? "revoked"
    : new Date(r.expires_at).getTime() <= Date.now() ? "expired" : "pending";
  return {
    id: r.id, phase, expiresAt: r.expires_at, content, companyName: (biz?.company_name as string) || "Your contractor",
    contact: [biz?.phone, biz?.email].filter(Boolean).join(" · "),
    signature: sig ? { signerName: sig.signer_name as string, signedAt: sig.signed_at as string } : null,
  };
}
