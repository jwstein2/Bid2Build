/**
 * Project update emails (informational, never promotional). Built only from the existing customer
 * report (src/lib/schedule/report.ts), so the email, PDF and share view always agree, and nothing
 * internal (prices, costs, subcontractor quotes, private notes) can appear.
 *
 * Completion accuracy: a section is "completed" only when its status was confirmed complete by someone
 * allowed to confirm completion. A section past its planned finish without that confirmation is
 * described as scheduled-through with its latest recorded progress, never as done.
 */
import { formatDay } from "@/lib/schedule/calendar";
import type { CustomerReport, ReportSection } from "@/lib/schedule/report";
import type { ScheduleData, Task } from "@/lib/schedule/types";
import { firstName } from "./nurture";
import { nextWeeklySlot } from "./time";
import type { UpdateFrequency } from "./types";

const long = (d: string) => formatDay(d, { month: "long", day: "numeric" });

export function sectionLine(s: ReportSection, today: string): string {
  if (s.status === "complete") return `${s.name}: completed${s.actualFinish ? ` ${long(s.actualFinish)}` : ""}.`;
  if (s.state === "upcoming") return `${s.name}: scheduled to start ${long(s.plannedStart)}.`;
  if (s.plannedEnd < today) {
    const pct = s.progress !== null ? ` Our latest recorded progress is ${s.progress}%.` : "";
    return `${s.name} was scheduled through ${long(s.plannedEnd)}.${pct} We'll share an updated completion status when it's confirmed.`;
  }
  const label = s.status === "delayed" ? "delayed" : s.status === "on_hold" ? "on hold" : s.status === "in_progress" ? "in progress" : "not started yet";
  return `${s.name}: ${label}${s.progress !== null && s.status !== "not_started" ? ` (${s.progress}% recorded)` : ""}, planned through ${long(s.plannedEnd)}.`;
}

export interface UpdateEmailOpts { link: string | null; contactName: string | null; milestone?: { sectionName: string } | null; unsubscribeUrl: string | null; postalAddress: string | null }

export function buildProjectUpdateEmail(r: CustomerReport, o: UpdateEmailOpts): { subject: string; body: string } {
  const first = firstName(r.customerName);
  const lines: string[] = [first ? `Hi ${first},` : "Hi,", ""];
  if (o.milestone) lines.push(`${o.milestone.sectionName} on ${r.projectTitle || "your project"} has been completed and confirmed by our project manager.`);
  else lines.push(`Here's this week's update on ${r.projectTitle || "your project"}.`);
  if (r.progress !== null) lines.push("", `Overall recorded progress: ${r.progress}%.`);
  if (r.forecastFinish) lines.push(`Current forecast completion: ${formatDay(r.forecastFinish, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${r.previousForecast ? ` (previously ${long(r.previousForecast)})` : ""}.`);
  const group = (state: ReportSection["state"], title: string) => {
    const xs = r.sections.filter((s) => s.state === state);
    if (xs.length) lines.push("", title, ...xs.map((s) => `• ${sectionLine(s, r.reportDate)}${s.change && !s.change.startsWith("Completed") ? ` ${s.change}` : ""}`));
  };
  group("completed", "Completed");
  group("current", "In progress");
  group("upcoming", "Coming up");
  if (r.notes) lines.push("", r.notes);
  if (r.provisional) lines.push("", "Dates are still provisional and may change as the schedule is confirmed.");
  if (o.link) lines.push("", "See the full schedule update:", o.link);
  lines.push("", "Questions? Just reply to this email.", "", "Thank you,", ...[o.contactName, r.company.name].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i));
  const foot = ["", "--", [r.company.name, o.postalAddress].filter(Boolean).join(" · ")];
  if (o.unsubscribeUrl) foot.push(`Prefer not to get these progress emails? ${o.unsubscribeUrl}`);
  lines.push(...foot);
  const subject = o.milestone ? `${o.milestone.sectionName} complete: ${r.projectTitle} — ${r.company.name}` : `Project update: ${r.projectTitle || "your project"} — ${r.company.name}`;
  return { subject: subject.slice(0, 300), body: lines.join("\n") };
}

export const wantsWeekly = (f: UpdateFrequency) => f === "weekly" || f === "both";
export const wantsMilestone = (f: UpdateFrequency) => f === "milestone" || f === "both";

/** Section heads confirmed complete on/after the date updates were switched on (milestone triggers). */
export function milestoneCandidates(tasks: Task[], enabledOn: string): Task[] {
  return tasks.filter((t) => t.kind === "section" && !t.splitFrom && t.status === "complete" && (t.actualFinish ?? "") >= enabledOn);
}

/** Weekly slot whose message should exist by now (created up to 36 hours ahead so the reminder can go out a day before). */
export function upcomingWeekly(now: Date, tz: string, weekday: number, hour: number): { slot: Date; createFrom: Date; reminderAt: Date } {
  const slot = nextWeeklySlot(new Date(now.getTime() - 60_000), tz, weekday, hour);
  return { slot, createFrom: new Date(slot.getTime() - 36 * 3_600_000), reminderAt: new Date(slot.getTime() - 24 * 3_600_000) };
}

/**
 * Automatic mode only sends when the information is reasonably current. Returns why it should pause for a
 * manager instead (null = fine). Work past its planned finish without a recent progress entry is the risk.
 */
export function staleReason(data: Pick<ScheduleData, "schedule" | "tasks">, today: string, now: Date): string | null {
  const days = (now.getTime() - Date.parse(data.schedule.updatedAt)) / 86_400_000;
  const overdue = data.tasks.filter((t) => t.kind === "section" && !t.splitFrom && t.status !== "complete" && t.plannedEnd < today);
  if (overdue.length && days > 7) return `${overdue[0].name} is past its planned finish and progress hasn't been updated in ${Math.floor(days)} days.`;
  if (days > 21) return `The schedule hasn't been updated in ${Math.floor(days)} days.`;
  return null;
}
