/**
 * V8.4 P2 calendar helpers: onboarding sessions, the out-of-office template, time zone formatting,
 * calendar grids and .ics invites. Pure functions (no server imports) so they can be unit tested.
 */
import { createHash, randomBytes } from "node:crypto";

export type SessionId = "win" | "run" | "grow";
type Item = { text: string; needs?: "team" | "pm" | "financials" };

/** The three customer onboarding sessions. Items marked `needs` show only when the customer's plan includes them. */
export const SESSIONS: Record<SessionId, { title: string; summary: string; agenda: Item[] }> = {
  win: {
    title: "Win the Job", summary: "Build a professional estimate and get it in front of your client.",
    agenda: [
      { text: "Set up your company profile, logo and bid style" }, { text: "Build an estimate with the trade calculators and Saved Items" },
      { text: "Send a proposal your client can sign online" }, { text: "Track opens, signatures and follow-ups" },
    ],
  },
  run: {
    title: "Run the Job", summary: "Turn a signed bid into a scheduled, organized project.",
    agenda: [
      { text: "Convert a signed bid into a project" }, { text: "Change orders and invoices" },
      { text: "Schedule crews and subcontractors in Project Command Center", needs: "pm" }, { text: "Add teammates and set what they can see", needs: "team" },
    ],
  },
  grow: {
    title: "Grow the Business", summary: "See what's working and win more of the right jobs.",
    agenda: [
      { text: "Read your pipeline and win rate" }, { text: "Referral links and reviews" },
      { text: "Job costing and the Financial Command Center", needs: "financials" }, { text: "Team reporting across estimators", needs: "team" },
    ],
  },
};

const has = (plan: string | null | undefined, need: Item["needs"]) => {
  const p = (plan ?? "").toLowerCase();
  if (need === "team") return /enterprise|team/.test(p);
  if (need === "pm") return /pm|project|command/.test(p);
  if (need === "financials") return /fin|account|enterprise|team/.test(p);
  return true;
};

/** Agenda for a customer's plan. Prospects (no plan) see the core items only. */
export function agendaFor(session: SessionId, plan: string | null | undefined): string[] {
  return SESSIONS[session].agenda.filter((i) => !i.needs || has(plan, i.needs)).map((i) => i.text);
}

export const DEFAULT_OOO = (rep: string, returnDate: string, support = "support@built2bid.org") =>
  `Hi,\n\nThanks for reaching out!\n\nI'm currently out of the office and will be returning on ${returnDate}.\n\nI'll follow up as soon as I'm available.\n\nIf you need assistance before then, please contact Built2Bid Support at ${support}.\n\nThanks for your patience!\n\n${rep}\nBuilt2Bid`;
export const OOO_SUBJECT = "Out of Office — Built2Bid";

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function fmtTime(iso: string | Date, tz: string, opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(iso));
}
export const fmtDay = (iso: string | Date, tz: string) => fmtTime(iso, tz, { weekday: "long", month: "long", day: "numeric" });
export const fmtWhen = (iso: string | Date, tz: string) => `${fmtDay(iso, tz)} at ${fmtTime(iso, tz)}`;

/** YYYY-MM-DD of an instant in a zone. */
export function ymd(d: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** The UTC instant of local midnight for a YYYY-MM-DD in a zone (DST-safe). */
export function zonedMidnight(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    const shown = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    guess -= shown - Date.UTC(y, m - 1, d);
  }
  return new Date(guess);
}

/** A local date + "HH:MM" in a zone to a UTC instant. */
export function zonedTime(day: string, hhmm: string, tz: string): Date {
  const [h, mi] = hhmm.split(":").map(Number);
  const mid = zonedMidnight(day, tz);
  const approx = new Date(mid.getTime() + (h * 60 + mi) * 60_000);
  // Correct across a DST change that happens between midnight and the time.
  const want = h * 60 + mi;
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(approx);
  const got = Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value);
  return new Date(approx.getTime() + (want - got) * 60_000);
}

export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const isoDow = (day: string) => { const w = new Date(`${day}T12:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };

export type CalView = "day" | "week" | "month";
/** The days a view shows, Monday-first. */
export function viewDays(view: CalView, anchor: string): string[] {
  if (view === "day") return [anchor];
  if (view === "week") { const start = addDays(anchor, 1 - isoDow(anchor)); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }
  const first = `${anchor.slice(0, 8)}01`;
  const start = addDays(first, 1 - isoDow(first));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return days[35].slice(0, 7) === anchor.slice(0, 7) ? days : days.slice(0, 35);
}

/** Groups open slots by local day for the booking page. */
export function slotsByDay(slots: string[], tz: string): { day: string; label: string; times: { iso: string; label: string }[] }[] {
  const map = new Map<string, { iso: string; label: string }[]>();
  for (const s of slots) {
    const k = ymd(new Date(s), tz);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push({ iso: s, label: fmtTime(s, tz) });
  }
  return [...map.entries()].map(([day, times]) => ({ day, label: fmtTime(`${day}T12:00:00Z`, "UTC", { weekday: "short", month: "short", day: "numeric" }), times }));
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,74}/g)!.join("\r\n ");

/** A standard calendar invite (works with Google, Outlook and Apple Calendar). */
export function icsInvite(e: { uid: string; start: string; end: string; summary: string; description: string; location?: string | null; organizer?: { name: string; email: string } | null; canceled?: boolean }): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Built2Bid//Sales Hub//EN", "CALSCALE:GREGORIAN", `METHOD:${e.canceled ? "CANCEL" : "PUBLISH"}`, "BEGIN:VEVENT",
    `UID:${e.uid}@built2bid.org`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.end)}`,
    `SUMMARY:${icsText(e.summary)}`, `DESCRIPTION:${icsText(e.description)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.organizer ? [`ORGANIZER;CN=${icsText(e.organizer.name)}:mailto:${e.organizer.email}`] : []),
    `STATUS:${e.canceled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const EVENT_KINDS: Record<string, { label: string; color: string }> = {
  call: { label: "Prospect call", color: "bg-sky-100 text-sky-900 border-sky-300" },
  follow_up: { label: "Follow-up", color: "bg-amber-100 text-amber-900 border-amber-300" },
  onboarding: { label: "Onboarding session", color: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  meeting: { label: "Meeting", color: "bg-violet-100 text-violet-900 border-violet-300" },
  personal: { label: "Personal (private)", color: "bg-slate-100 text-slate-800 border-slate-300" },
  focus: { label: "Focus time", color: "bg-rose-100 text-rose-900 border-rose-300" },
};
