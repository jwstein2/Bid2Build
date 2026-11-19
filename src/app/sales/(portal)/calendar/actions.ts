"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesRep } from "@/lib/sales/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createEvent, deleteEvent, setResponder } from "@/lib/sales/google";
import { fmtDay, OOO_SUBJECT, zonedMidnight, zonedTime, addDays } from "@/lib/sales/calendar";

/**
 * The rep's own calendar actions. Every write goes through a sales_my_* function that only touches the
 * signed-in rep's rows. Google is updated afterwards, best effort: a Google failure never undoes the
 * Sales Hub change, and only events we created are ever changed or removed.
 */

const ERR: Record<string, string> = {
  invalid_time_zone: "Pick a valid time zone.", invalid_hours: "Check your weekly hours: each block needs a start before its end.",
  slug_required: "Choose a link name before turning on booking.", slug_taken: "That link name is taken. Try another.",
  check: "Check the dates: the end must be after the start.", not_found: "That item wasn't found.", invalid: "Check the form and try again.",
};
function back(q: Record<string, string>, path = "/sales/calendar"): never {
  revalidatePath("/sales/calendar");
  redirect(`${path}?${new URLSearchParams(q).toString()}`);
}
const code = (m?: string) => Object.keys(ERR).find((k) => (m ?? "").includes(k)) ?? "invalid";
const keep = (fd: FormData) => ({ view: String(fd.get("view") ?? "week"), date: String(fd.get("date") ?? "") });
const DAY = /^\d{4}-\d{2}-\d{2}$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const tzOk = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

export async function saveEvent(fd: FormData) {
  const { db } = await requireSalesRep();
  const tz = String(fd.get("tz") ?? "America/Chicago"), day = String(fd.get("day") ?? ""), allDay = fd.get("all_day") === "on";
  const s = String(fd.get("start") ?? "09:00"), e = String(fd.get("end") ?? "09:30");
  if (!tzOk(tz) || !DAY.test(day) || (!allDay && (!HM.test(s) || !HM.test(e)))) back({ ...keep(fd), err: ERR.invalid });
  const starts = allDay ? zonedMidnight(day, tz) : zonedTime(day, s, tz);
  const ends = allDay ? zonedMidnight(addDays(day, 1), tz) : zonedTime(day, e, tz);
  const id = fd.get("id") ? z.string().uuid().safeParse(fd.get("id")) : { success: true as const, data: null };
  if (!id.success) back({ ...keep(fd), err: ERR.invalid });
  const { error } = await db.rpc("sales_my_event_save", {
    p_id: id.data, p_kind: String(fd.get("kind") ?? "meeting"), p_title: String(fd.get("title") ?? "").slice(0, 200), p_description: String(fd.get("description") ?? "").slice(0, 2000),
    p_starts_at: starts.toISOString(), p_ends_at: ends.toISOString(), p_all_day: allDay, p_lead_id: null,
  });
  if (error) back({ ...keep(fd), err: ERR[code(error.message)] });
  back({ ...keep(fd), ok: "Saved." });
}

export async function deleteCalendarEvent(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (id.success) await db.rpc("sales_my_event_delete", { p_id: id.data });
  back({ ...keep(fd), ok: "Removed." });
}

export async function saveCalendarSettings(fd: FormData) {
  const { db } = await requireSalesRep();
  const rules = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => fd.get(`on_${d}`) === "on" ? [{ d, s: String(fd.get(`s_${d}`) ?? "09:00"), e: String(fd.get(`e_${d}`) ?? "17:00") }] : []);
  const n = (k: string, dflt: number) => { const v = Number(fd.get(k)); return Number.isFinite(v) ? Math.round(v) : dflt; };
  const { error } = await db.rpc("sales_my_calendar_settings_save", {
    p_time_zone: String(fd.get("time_zone") ?? "America/Chicago"), p_booking_slug: String(fd.get("booking_slug") ?? "").trim().toLowerCase(),
    p_booking_enabled: fd.get("booking_enabled") === "on", p_session_minutes: n("session_minutes", 30), p_buffer_minutes: n("buffer_minutes", 0),
    p_min_notice_hours: n("min_notice_hours", 12), p_max_days_ahead: n("max_days_ahead", 30), p_rules: rules, p_meeting_link: String(fd.get("meeting_link") ?? "").trim(),
  });
  if (error) back({ tab: "settings", err: ERR[code(error.message)] ?? (/check/.test(error.message) ? "Link names use lowercase letters, numbers and dashes (3-40)." : ERR.invalid) });
  back({ tab: "settings", ok: "Availability saved." });
}

/** Saves time off, then (when connected) adds a Google out-of-office block and the Gmail vacation responder. */
export async function saveTimeOff(fd: FormData) {
  const { db, rep } = await requireSalesRep();
  const tz = String(fd.get("tz") ?? "America/Chicago"), from = String(fd.get("from") ?? ""), to = String(fd.get("to") ?? ""), allDay = fd.get("all_day") !== "off";
  const st = String(fd.get("start_time") ?? "09:00"), et = String(fd.get("end_time") ?? "17:00");
  if (!tzOk(tz) || !DAY.test(from) || !DAY.test(to) || (!allDay && (!HM.test(st) || !HM.test(et)))) back({ tab: "timeoff", err: ERR.invalid });
  const starts = allDay ? zonedMidnight(from, tz) : zonedTime(from, st, tz);
  const ends = allDay ? zonedMidnight(addDays(to, 1), tz) : zonedTime(to, et, tz);
  const message = String(fd.get("customer_message") ?? "").trim().slice(0, 2000);
  if (!message) back({ tab: "timeoff", err: "Add the message customers will see." });
  const { data, error } = await db.rpc("sales_my_time_off_save", {
    p_id: null, p_starts_at: starts.toISOString(), p_ends_at: ends.toISOString(), p_all_day: allDay, p_note: String(fd.get("note") ?? "").slice(0, 500),
    p_customer_message: message, p_backup_contact: String(fd.get("backup_contact") ?? "").trim().slice(0, 200),
  });
  if (error) back({ tab: "timeoff", err: ERR[code(error.message)] ?? (/check/.test(error.message) ? ERR.check : ERR.invalid) });
  const t = data as { id: string; bookings: unknown[]; tasks: unknown[]; events: unknown[] };
  const admin = createAdminClient();
  const ooo = await createEvent(admin, rep.id, { summary: "Out of office", description: message, start: starts.toISOString(), end: ends.toISOString(), outOfOffice: true });
  const responder = fd.get("responder") === "on" ? await setResponder(admin, rep.id, { enable: true, subject: OOO_SUBJECT, body: message, start: starts.toISOString(), end: ends.toISOString() }) : "off";
  await admin.rpc("sales_calendar_mark", { p_kind: "time_off", p_id: t.id, p_google_event_id: ooo, p_responder_status: responder, p_error: responder === "failed" ? "Gmail didn't accept the responder." : null });
  const flags = t.bookings.length + t.tasks.length + t.events.length;
  back({ tab: "timeoff", ok: `Time off saved for ${fmtDay(starts, tz)}${to !== from ? ` to ${fmtDay(new Date(ends.getTime() - 1), tz)}` : ""}. New bookings are blocked.${flags ? ` ${flags} item${flags === 1 ? "" : "s"} during your absence may need attention (listed below). Nothing was canceled.` : ""}${responder === "set" ? " Gmail auto-reply is on." : ""}` });
}

export async function cancelTimeOff(fd: FormData) {
  const { db, rep } = await requireSalesRep();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back({ tab: "timeoff", err: ERR.invalid });
  const { data, error } = await db.rpc("sales_my_time_off_cancel", { p_id: id.data });
  if (error) back({ tab: "timeoff", err: ERR.not_found });
  const t = data as { google_event_id: string | null; responder_status: string };
  const admin = createAdminClient();
  await deleteEvent(admin, rep.id, t.google_event_id);
  if (t.responder_status === "set") await setResponder(admin, rep.id, { enable: false, subject: "", body: "", start: new Date().toISOString(), end: new Date().toISOString() });
  back({ tab: "timeoff", ok: "Time off removed. Booking is open again for those days." });
}

export async function cancelMyBooking(fd: FormData) {
  const { db, rep } = await requireSalesRep();
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back({ ...keep(fd), err: ERR.invalid });
  const { data, error } = await db.rpc("sales_my_booking_cancel", { p_id: id.data, p_reason: String(fd.get("reason") ?? "").slice(0, 300) });
  if (error) back({ ...keep(fd), err: ERR.not_found });
  await deleteEvent(createAdminClient(), rep.id, (data as { google_event_id: string | null }).google_event_id);
  back({ ...keep(fd), ok: "Session canceled. Let the customer know and offer a new time with your booking link." });
}

export async function disconnectGoogle() {
  const { rep } = await requireSalesRep();
  const admin = createAdminClient();
  const { data } = await admin.from("sales_google_connections").select("refresh_token_sealed").eq("rep_id", rep.id).maybeSingle();
  if (data) {
    try {
      const { openToken } = await import("@/lib/tax-banking/bank/token-crypto");
      const tok = openToken((data as { refresh_token_sealed: string }).refresh_token_sealed, process.env.SALES_TOKEN_KEY || process.env.BANK_TOKEN_KEY);
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tok }) });
    } catch { /* already revoked or key changed: removing our copy is what matters */ }
    await admin.from("sales_google_connections").delete().eq("rep_id", rep.id);
  }
  back({ tab: "settings", ok: "Google Calendar disconnected. Events we added stay in your Google Calendar." });
}
