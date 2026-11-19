import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { busyTimes } from "@/lib/sales/google";

export type MeetPage = { rep_id: string; first_name: string; time_zone: string; session_minutes: number; enabled: boolean };

/** Open slots for a booking link, with Google busy times removed when the rep has connected Google. */
export async function loadSlots(slug: string): Promise<{ page: MeetPage | null; slots: string[] }> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("sales_booking_page", { p_slug: slug });
  const page = data as MeetPage | null;
  if (!page || !page.enabled) return { page, slots: [] };
  const busy = await busyTimes(admin, page.rep_id, new Date(), new Date(Date.now() + 91 * 86_400_000));
  const { data: rows } = await admin.rpc("sales_booking_slots", { p_slug: slug, p_extra_busy: busy });
  return { page, slots: ((rows ?? []) as { starts_at: string }[]).map((r) => new Date(r.starts_at).toISOString()) };
}

export const US_ZONES = [["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"]] as const;
export const zoneOk = (z: string | undefined, dflt: string) => (z && US_ZONES.some(([v]) => v === z) ? z : dflt);
