import "server-only";
import { customerEmailsOn } from "./google";
import { agendaFor, fmtWhen, icsInvite, SESSIONS, type SessionId } from "./calendar";
import { site } from "@/lib/site";
import { logError } from "@/lib/http/api";

/**
 * Customer booking emails (confirmation, change, cancellation, day-before reminder). Sent only when
 * SALES_BOOKING_EMAILS=on and RESEND_API_KEY is set; otherwise the booking page itself is the
 * confirmation (with a calendar file to download). From noreply@built2bid.org (verified domain), replies
 * go to the rep.
 */
export type BookingMail = { id: string; kind: "confirmed" | "rescheduled" | "canceled" | "reminder"; to: string; name: string; session: SessionId; start: string; end: string;
  tz: string; repName: string; repEmail: string; meetingLink?: string | null; plan?: string | null; manageUrl?: string | null };

export function bookingText(m: BookingMail): { subject: string; text: string } {
  const s = SESSIONS[m.session];
  const when = `${fmtWhen(m.start, m.tz)} (${m.tz.replace("_", " ")})`;
  const head = { confirmed: `You're booked: ${s.title}`, rescheduled: `New time: ${s.title}`, canceled: `Canceled: ${s.title}`, reminder: `Tomorrow: ${s.title}` }[m.kind];
  const lines = [`Hi ${m.name.split(" ")[0]},`, "",
    m.kind === "canceled" ? `Your ${s.title} session on ${when} is canceled.` : `Your ${s.title} session with ${m.repName} is ${m.kind === "reminder" ? "tomorrow" : "set"}: ${when}.`,
    ...(m.kind !== "canceled" ? ["", "What we'll cover:", ...agendaFor(m.session, m.plan).map((a) => `- ${a}`), ...(m.meetingLink ? ["", `Join: ${m.meetingLink}`] : [])] : []),
    ...(m.manageUrl && m.kind !== "canceled" ? ["", `Need a different time? ${m.manageUrl}`] : []),
    ...(m.kind === "canceled" ? ["", `Book another time any time: ${m.manageUrl ?? site.url}`] : []),
    "", m.repName, "Built2Bid"];
  return { subject: head, text: lines.join("\n") };
}

export async function sendBookingEmail(m: BookingMail, f: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!customerEmailsOn() || !key) return false;
  const { subject, text } = bookingText(m);
  const ics = icsInvite({ uid: m.id, start: m.start, end: m.end, summary: `${SESSIONS[m.session].title} with ${m.repName} (Built2Bid)`, description: text, location: m.meetingLink, organizer: { name: m.repName, email: m.repEmail }, canceled: m.kind === "canceled" });
  try {
    const r = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": `sales-booking/${m.id}/${m.kind}` },
      body: JSON.stringify({ from: "Built2Bid <noreply@built2bid.org>", to: [m.to], reply_to: m.repEmail, subject, text,
        attachments: [{ filename: "invite.ics", content: Buffer.from(ics).toString("base64"), content_type: "text/calendar" }] }),
    });
    if (!r.ok) logError("sales.booking_email", new Error(`resend ${r.status}`));
    return r.ok;
  } catch (e) {
    logError("sales.booking_email", e);
    return false;
  }
}

/** Day-before reminders, once per booking. Returns how many were sent. */
export async function sendDayBeforeReminders(admin: import("@supabase/supabase-js").SupabaseClient, now = new Date()): Promise<number> {
  if (!customerEmailsOn()) return 0;
  const { data } = await admin.from("sales_bookings")
    .select("id,session,starts_at,ends_at,customer_name,customer_email,customer_plan,rep_id,sales_reps!sales_bookings_rep_id_fkey(full_name,email)")
    .eq("status", "booked").is("reminder_sent_at", null)
    .gte("starts_at", new Date(now.getTime() + 12 * 3_600_000).toISOString()).lt("starts_at", new Date(now.getTime() + 36 * 3_600_000).toISOString()).limit(100);
  const rows = (data ?? []) as unknown as { rep_id: string }[];
  const { data: cals } = rows.length ? await admin.from("sales_rep_calendar").select("rep_id,time_zone,meeting_link").in("rep_id", [...new Set(rows.map((r) => r.rep_id))]) : { data: [] };
  const cal = new Map(((cals ?? []) as { rep_id: string; time_zone: string; meeting_link: string | null }[]).map((c) => [c.rep_id, c]));
  let sent = 0;
  for (const b of rows.map((r) => ({ ...r, sales_rep_calendar: cal.get(r.rep_id) ?? null })) as unknown as { id: string; session: SessionId; starts_at: string; ends_at: string; customer_name: string; customer_email: string; customer_plan: string | null;
    sales_reps: { full_name: string; email: string } | null; sales_rep_calendar: { time_zone: string; meeting_link: string | null } | null }[]) {
    const ok = await sendBookingEmail({ id: b.id, kind: "reminder", to: b.customer_email, name: b.customer_name, session: b.session, start: b.starts_at, end: b.ends_at,
      tz: b.sales_rep_calendar?.time_zone ?? "America/Chicago", repName: b.sales_reps?.full_name ?? "Built2Bid", repEmail: b.sales_reps?.email ?? "support@built2bid.org",
      meetingLink: b.sales_rep_calendar?.meeting_link, plan: b.customer_plan, manageUrl: null });
    if (ok) { await admin.from("sales_bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", b.id); sent++; }
  }
  return sent;
}
