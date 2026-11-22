import { isIsoDate } from "@/lib/schedule/calendar";

/**
 * One calendar for every "Open schedule" action: the company calendar in the Projects workspace
 * (/projects?view=calendar). Links carry optional context so the calendar opens where it matters:
 *   project – narrow to one project (a schedule id) and name it in a banner
 *   date    – open on this day instead of today
 *   task    – highlight this task (and open on its start when no date is given)
 *   member  – narrow to one assignee (an assigneeKey such as "r:<resource id>")
 *   mode    – month | week | day | agenda
 * Nothing here grants access: the calendar only ever shows rows the database already allowed.
 */
export const CAL_MODES = ["month", "week", "day", "agenda"] as const;
export type CalLinkMode = (typeof CAL_MODES)[number];
export interface CalendarContext { project?: string | null; date?: string | null; task?: string | null; member?: string | null; mode?: CalLinkMode | null }

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MEMBER = /^(r:[A-Za-z0-9_-]{1,64}|t:.{1,120})$/;

export const CALENDAR_PATH = "/projects";

export function calendarHref(ctx: CalendarContext = {}): string {
  const q = new URLSearchParams({ view: "calendar" });
  if (ctx.project && ID.test(ctx.project)) q.set("project", ctx.project);
  if (ctx.task && ID.test(ctx.task)) q.set("task", ctx.task);
  if (ctx.date && isIsoDate(ctx.date)) q.set("date", ctx.date);
  if (ctx.member && MEMBER.test(ctx.member)) q.set("member", ctx.member);
  if (ctx.mode && (CAL_MODES as readonly string[]).includes(ctx.mode)) q.set("mode", ctx.mode);
  return `${CALENDAR_PATH}?${q}`;
}

/** Reads calendar context back from the URL. Anything malformed is dropped, never trusted. */
export function readCalendarContext(params: { get(k: string): string | null }): Required<{ [K in keyof CalendarContext]: NonNullable<CalendarContext[K]> | null }> {
  const get = (k: string) => { const v = params.get(k); return v && v.length ? v : null; };
  const project = get("project"), task = get("task"), date = get("date"), member = get("member"), mode = get("mode");
  return {
    project: project && ID.test(project) ? project : null,
    task: task && ID.test(task) ? task : null,
    date: date && isIsoDate(date) ? date : null,
    member: member && MEMBER.test(member) ? member : null,
    mode: mode && (CAL_MODES as readonly string[]).includes(mode) ? (mode as CalLinkMode) : null,
  };
}

/** Context params the calendar owns; dropped from the URL when the user clears that context. */
export const CONTEXT_KEYS = ["project", "task", "date", "member", "mode"] as const;
