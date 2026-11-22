"use server";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/http/api";
import { busyTimes, createEvent, deleteEvent } from "@/lib/sales/google";
import { hashToken, newToken, SESSIONS, agendaFor, type SessionId } from "@/lib/sales/calendar";
import { sendBookingEmail } from "@/lib/sales/booking-email";
import { site } from "@/lib/site";
import { verifyBookingRef } from "@/lib/sales/nurture/tokens";

/**
 * Public client self-scheduling. Runs with the service role but only through the booking functions,
 * which re-check the slot under a per-rep lock. The secret link (only its hash is stored) lets the
 * customer reschedule or cancel. Rate limited per visitor.
 */
const ERR: Record<string, string> = { slot_taken: "taken", too_many_bookings: "too_many", invalid_contact: "contact", invalid_session: "invalid", not_found: "invalid", not_cancelable: "closed" };
const code = (m?: string) => ERR[Object.keys(ERR).find((k) => (m ?? "").includes(k)) ?? "not_found"];
const isSession = (s: string): s is SessionId => s === "win" || s === "run" || s === "grow" || s === "intro";

export async function bookSession(fd: FormData) {
  const slug = String(fd.get("slug") ?? "").toLowerCase().slice(0, 40), session = String(fd.get("session") ?? ""), at = String(fd.get("at") ?? "");
  const ref = String(fd.get("ref") ?? "").slice(0, 80);
  const back = (e: string) => redirect(`/meet/${encodeURIComponent(slug)}?${new URLSearchParams({ session, err: e, ...(ref ? { ref } : {}) })}`);
  if (fd.get("website")) back("invalid"); // honeypot
  if (!(await rateLimit("meet-book", 8, 10 * 60_000))) back("slow");
  if (!isSession(session) || Number.isNaN(Date.parse(at))) back("invalid");
  const admin = createAdminClient();
  const { data: page } = await admin.rpc("sales_booking_page", { p_slug: slug });
  const p = page as { rep_id: string } | null;
  if (!p) back("invalid");
  const start = new Date(at);
  const busy = await busyTimes(admin, p!.rep_id, new Date(start.getTime() - 3_600_000), new Date(start.getTime() + 3 * 3_600_000));
  const { token, hash } = newToken();
  const { data, error } = await admin.rpc("sales_booking_create", {
    p_slug: slug, p_session: session, p_start: start.toISOString(), p_name: String(fd.get("name") ?? "").slice(0, 120), p_email: String(fd.get("email") ?? "").slice(0, 320),
    p_company: String(fd.get("company") ?? "").slice(0, 200), p_notes: String(fd.get("notes") ?? "").slice(0, 1000), p_token_hash: hash, p_extra_busy: busy,
  });
  if (error) back(code(error.message));
  const b = data as { id: string; starts_at: string; ends_at: string; plan: string | null; rep_id: string; rep_name: string; rep_email: string; time_zone: string; meeting_link: string | null };
  // Booked from a sales follow-up email: link it to that campaign (stops the follow-ups, logs the meeting).
  const campaignId = verifyBookingRef(ref);
  if (campaignId) await admin.rpc("sales_campaign_booking_link", { p_campaign: campaignId, p_booking: b.id }).then(() => null, () => null);
  const manageUrl = new URL(`/meet/booking/${token}`, site.url).toString();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const gid = await createEvent(admin, b.rep_id, { summary: `${SESSIONS[session as SessionId].title}: ${String(fd.get("name"))}`,
    description: [session === "intro" ? "Built2Bid walkthrough booked through your link." : `Built2Bid onboarding session booked through your link.`, "", ...agendaFor(session as SessionId, b.plan).map((x) => `- ${x}`), "", `Customer: ${email}`].join("\n"),
    start: b.starts_at, end: b.ends_at, attendee: email, location: b.meeting_link });
  if (gid) await admin.rpc("sales_calendar_mark", { p_kind: "booking", p_id: b.id, p_google_event_id: gid });
  if (await sendBookingEmail({ id: b.id, kind: "confirmed", to: email, name: String(fd.get("name")), session: session as SessionId, start: b.starts_at, end: b.ends_at, tz: b.time_zone, repName: b.rep_name, repEmail: b.rep_email, meetingLink: b.meeting_link, plan: b.plan, manageUrl })) {
    await admin.from("sales_bookings").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", b.id);
  }
  redirect(`/meet/booking/${token}?new=1`);
}

export async function rescheduleSession(fd: FormData) {
  const token = String(fd.get("token") ?? ""), at = String(fd.get("at") ?? "");
  const back = (q: string) => redirect(`/meet/booking/${encodeURIComponent(token)}?${q}`);
  if (!(await rateLimit("meet-manage", 10, 10 * 60_000))) back("err=slow");
  if (Number.isNaN(Date.parse(at))) back("err=invalid");
  const admin = createAdminClient();
  const { data: cur } = await admin.rpc("sales_booking_by_token", { p_token_hash: hashToken(token) });
  const c = cur as { rep_id: string; customer_email: string; customer_name: string; session: SessionId; plan: string | null; meeting_link: string | null; time_zone: string } | null;
  if (!c) back("err=invalid");
  const start = new Date(at);
  const busy = await busyTimes(admin, c!.rep_id, new Date(start.getTime() - 3_600_000), new Date(start.getTime() + 3 * 3_600_000));
  const { data, error } = await admin.rpc("sales_booking_reschedule", { p_token_hash: hashToken(token), p_start: start.toISOString(), p_extra_busy: busy });
  if (error) back(`err=${code(error.message)}`);
  const r = data as { id: string; old_google_event_id: string | null; starts_at: string; ends_at: string; rep_id: string };
  await deleteEvent(admin, r.rep_id, r.old_google_event_id);
  const gid = await createEvent(admin, r.rep_id, { summary: `${SESSIONS[c!.session].title}: ${c!.customer_name}`, description: `Rescheduled by the customer.\n\nCustomer: ${c!.customer_email}`,
    start: r.starts_at, end: r.ends_at, attendee: c!.customer_email, location: c!.meeting_link });
  if (gid) await admin.rpc("sales_calendar_mark", { p_kind: "booking", p_id: r.id, p_google_event_id: gid });
  const { data: rep } = await admin.from("sales_reps").select("full_name,email").eq("id", r.rep_id).single();
  await sendBookingEmail({ id: r.id, kind: "rescheduled", to: c!.customer_email, name: c!.customer_name, session: c!.session, start: r.starts_at, end: r.ends_at, tz: c!.time_zone,
    repName: (rep as { full_name: string }).full_name, repEmail: (rep as { email: string }).email, meetingLink: c!.meeting_link, plan: c!.plan, manageUrl: new URL(`/meet/booking/${token}`, site.url).toString() });
  back("moved=1");
}

export async function cancelSession(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const back = (q: string) => redirect(`/meet/booking/${encodeURIComponent(token)}?${q}`);
  if (!(await rateLimit("meet-manage", 10, 10 * 60_000))) back("err=slow");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("sales_booking_cancel", { p_token_hash: hashToken(token), p_reason: String(fd.get("reason") ?? "").slice(0, 300) });
  if (error) back(`err=${code(error.message)}`);
  const r = data as { rep_id: string; google_event_id: string | null };
  await deleteEvent(admin, r.rep_id, r.google_event_id);
  back("canceled=1");
}
