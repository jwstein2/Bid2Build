import { describe, expect, it } from "vitest";
import { calendarHref, readCalendarContext } from "@/lib/projects/calendar-link";
import { QUICK_ACTIONS } from "@/lib/dashboard/registry";

const read = (href: string) => readCalendarContext(new URL(href, "https://x.test").searchParams);

describe("calendarHref", () => {
  it("opens the existing company calendar with no context by default", () => {
    expect(calendarHref()).toBe("/projects?view=calendar");
    expect(QUICK_ACTIONS.open_schedule.href).toBe(calendarHref());
  });

  it("carries project, task, date, member and mode, and reads them back", () => {
    const href = calendarHref({ project: "5d6c1d2e-1111-4222-8333-944445555666", task: "t-1", date: "2026-12-03", member: "r:abc", mode: "week" });
    expect(href.startsWith("/projects?view=calendar&")).toBe(true);
    expect(read(href)).toEqual({ project: "5d6c1d2e-1111-4222-8333-944445555666", task: "t-1", date: "2026-12-03", member: "r:abc", mode: "week" });
  });

  it("drops malformed context instead of passing it through", () => {
    const href = calendarHref({ project: "../etc", date: "2026-02-30", mode: "year" as never, member: "x:bad" });
    expect(href).toBe("/projects?view=calendar");
    expect(read("/projects?view=calendar&project=%3Cscript%3E&date=tomorrow&mode=year")).toEqual({ project: null, task: null, date: null, member: null, mode: null });
  });

  it("keeps free-text assignees", () => {
    expect(read(calendarHref({ member: "t:crew a" })).member).toBe("t:crew a");
  });
});
