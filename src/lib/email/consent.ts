import type { SupabaseClient } from "@supabase/supabase-js";
import { MARKETING_CONSENT_TEXT, MARKETING_CONSENT_VERSION, type ConsentSource } from "./consent-copy";

export { MARKETING_CONSENT_TEXT, MARKETING_CONSENT_VERSION };

/** Postgres "undefined column/table" and PostgREST "not in schema cache": the consent SQL hasn't run yet. */
const missingSchema = (e: { code?: string } | null | undefined) => !!e && ["42703", "42P01", "PGRST204", "PGRST205"].includes(e.code ?? "");

/**
 * Records a marketing-consent change for one account (service-role client, server only).
 *  - Opt in: marketing_opt_in, when, where (source) and which notice version.
 *  - Opt out: clears opt-in, keeps the original source/version for the record, stamps marketing_opt_out_at.
 *  - Appends a row to marketing_consent_events (an audit trail that survives later changes).
 * Until migration 20261123001000 runs, it falls back to the original two columns so nothing breaks.
 * It never touches sign-in, verification or transactional email.
 */
export async function recordMarketingConsent(db: SupabaseClient, userId: string, c: { optIn: boolean; source: ConsentSource; at?: Date }) {
  const at = (c.at ?? new Date()).toISOString();
  const full = c.optIn
    ? { marketing_opt_in: true, marketing_opt_in_at: at, marketing_consent_source: c.source, marketing_consent_version: MARKETING_CONSENT_VERSION, marketing_opt_out_at: null }
    : { marketing_opt_in: false, marketing_opt_in_at: null, marketing_opt_out_at: at };
  const { error } = await db.from("profiles").update(full).eq("id", userId);
  if (missingSchema(error)) {
    await db.from("profiles").update({ marketing_opt_in: c.optIn, marketing_opt_in_at: c.optIn ? at : null }).eq("id", userId);
  } else if (error) {
    throw new Error(`consent update failed: ${error.message}`);
  }
  const { error: e2 } = await db.from("marketing_consent_events").insert({
    user_id: userId, opted_in: c.optIn, source: c.source, notice_version: MARKETING_CONSENT_VERSION,
    notice_text: c.optIn ? MARKETING_CONSENT_TEXT : null, created_at: at,
  });
  if (e2 && !missingSchema(e2)) throw new Error(`consent event failed: ${e2.message}`);
}
