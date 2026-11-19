import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";

export type SigningEventKind = "viewed" | "pdf_downloaded" | "signed" | "copy_emailed";
export interface SigningEvent { event: SigningEventKind; at: string; ipAddress: string | null; userAgent: string | null }

export const EVENT_LABELS: Record<SigningEventKind, string> = {
  viewed: "Signing page opened",
  pdf_downloaded: "PDF downloaded",
  signed: "Signed",
  copy_emailed: "Signed copy emailed to signer",
};

const missingTable = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /signing_events/.test(e.message ?? "")));

/** Append one audit event (service role). Best effort: never blocks or fails the signing flow. */
export async function recordSigningEvent(admin: SupabaseClient, requestId: string, event: SigningEventKind, evidence: { ip: string | null; userAgent: string | null }): Promise<void> {
  try {
    const { error } = await admin.from("signing_events").insert({ request_id: requestId, event, ip_address: evidence.ip?.slice(0, 64) ?? null, user_agent: evidence.userAgent?.slice(0, 500) ?? null });
    if (error && !missingTable(error)) logError("esign.event", error, { request: requestId, event });
  } catch (e) {
    logError("esign.event", e, { request: requestId, event });
  }
}

/** The audit trail for a request, oldest first (service role). Empty until the migration has run. */
export async function listSigningEvents(admin: SupabaseClient, requestId: string): Promise<SigningEvent[]> {
  const { data, error } = await admin.from("signing_events").select("event, ip_address, user_agent, created_at").eq("request_id", requestId).order("id", { ascending: true }).limit(200);
  if (error) { if (!missingTable(error)) logError("esign.events", error, { request: requestId }); return []; }
  return (data ?? []).map((r) => ({ event: r.event as SigningEventKind, at: r.created_at, ipAddress: r.ip_address, userAgent: r.user_agent }));
}
