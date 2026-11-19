/**
 * Calling compliance for sales reps (legal review 2026-11-19). Pure helpers shared by the lead page and
 * tests. The database enforces the same rules in sales_crm_activity_add (20270119002000_sales_compliance.sql).
 */
export type DncStatus = "unchecked" | "clear" | "listed";
export type PhoneLine = "unknown" | "landline" | "mobile" | "voip";

/** National Do Not Call Registry access for sellers (requires a free or paid subscription account). */
export const DNC_REGISTRY_URL = "https://telemarketing.donotcall.gov/";
export const CALL_WINDOW = { startHour: 9, endHour: 20 } as const; // local, end exclusive

const ZONES: [string, string[]][] = [
  ["America/New_York", ["CT", "DE", "DC", "FL", "GA", "IN", "KY", "ME", "MD", "MA", "MI", "NH", "NJ", "NY", "NC", "OH", "PA", "RI", "SC", "VT", "VA", "WV"]],
  ["America/Chicago", ["AL", "AR", "IL", "IA", "KS", "LA", "MN", "MS", "MO", "NE", "ND", "OK", "SD", "TN", "TX", "WI"]],
  ["America/Denver", ["CO", "ID", "MT", "NM", "UT", "WY"]],
  ["America/Phoenix", ["AZ"]],
  ["America/Los_Angeles", ["CA", "NV", "OR", "WA"]],
  ["America/Anchorage", ["AK"]],
  ["Pacific/Honolulu", ["HI"]],
];

/** Mirrors public.sales_state_tz: the zone most of the state is in; unknown states use Central. */
export function stateTimeZone(state: string | null | undefined): string {
  const s = (state ?? "").trim().toUpperCase();
  return ZONES.find(([, list]) => list.includes(s))?.[0] ?? "America/Chicago";
}

export function localHour(state: string | null | undefined, at: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: stateTimeZone(state) }).format(at);
  return Number(h) % 24;
}

export function localTimeLabel(state: string | null | undefined, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: stateTimeZone(state) }).format(at);
}

export const inCallWindow = (state: string | null | undefined, at: Date = new Date()) => {
  const h = localHour(state, at);
  return h >= CALL_WINDOW.startHour && h < CALL_WINDOW.endHour;
};

export interface CallReadiness { canCall: boolean; canText: boolean; reasons: string[] }

/** What stands between the rep and a compliant call or text right now. */
export function callReadiness(l: { do_not_contact: boolean; dnc_status?: DncStatus | null; text_consent_at?: string | null; state?: string | null }, at: Date = new Date()): CallReadiness {
  const reasons: string[] = [];
  if (l.do_not_contact) reasons.push("This business asked not to be contacted.");
  const dnc = l.dnc_status ?? "unchecked";
  if (dnc === "listed") reasons.push("This number is on the National Do Not Call Registry. Don't call or text it.");
  if (dnc === "unchecked") reasons.push("Check this number against the National Do Not Call Registry and record the result first.");
  const window = inCallWindow(l.state, at);
  if (!window) reasons.push(`It's ${localTimeLabel(l.state, at)} there. Call only between 9 AM and 8 PM their time.`);
  const base = !l.do_not_contact && dnc === "clear" && window;
  return { canCall: base, canText: base && Boolean(l.text_consent_at), reasons };
}

/** Friendly messages for the database's refusals. */
export const ACTIVITY_ERRORS: Record<string, string> = {
  do_not_contact: "This business asked not to be contacted, so that can't be logged.",
  dnc_listed: "This number is on the Do Not Call Registry. Calls and texts to it aren't allowed.",
  dnc_unchecked: "Record a Do Not Call check for this number before logging a call or text.",
  text_needs_consent: "Texts need the prospect's written consent on file (for example, they texted you first or agreed in writing). Record it in Before you call.",
  outside_calling_hours: "Calls and texts are only allowed between 9 AM and 8 PM in the lead's time zone.",
};

export function activityErrorMessage(message: string | undefined | null): string {
  const key = Object.keys(ACTIVITY_ERRORS).find((k) => (message ?? "").includes(k));
  return key ? ACTIVITY_ERRORS[key] : "That couldn't be logged.";
}
