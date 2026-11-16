/**
 * Customer schedule updates (V4 Phase 8). The contractor previews exactly what the homeowner will see,
 * then publishes it. A published update is a frozen copy of this report: later schedule edits never
 * change it.
 *
 * What a report may contain is decided here and nowhere else. It is built only from schedule dates,
 * statuses and % complete, the frozen scope names in the schedule snapshot, and text the contractor
 * typed for the customer. It never contains prices, unit costs, margins, profit, quantities, task
 * weights, free-text assignees or the private notes on tasks. Defaults hide line-item detail and scope.
 * Who's doing a section appears only for Team & Subcontractors assignments, and only as the project's
 * report setting allows (names by default; contact details only when the contractor turns them on).
 */
import { z } from "zod";
import { formatDay } from "./calendar";
import { finishOf } from "./engine";
import { progressOf, sectionProgress } from "./progress";
import type { ScheduleData, Task, TaskStatus } from "./types";

export const REPORT_VERSION = 1;
const MAX_NOTES = 2000;
const MAX_SCOPE = 600;

export const reportOptionsSchema = z.object({
  showProgress: z.boolean().default(true),
  showTimeline: z.boolean().default(true),
  showCompleted: z.boolean().default(true),
  showCurrent: z.boolean().default(true),
  showUpcoming: z.boolean().default(true),
  /** Scheduled line items under each section. Off by default. */
  showTaskDetails: z.boolean().default(false),
  /** Scope summaries, per section: only sections listed in `scope` show one. Off by default. */
  showScope: z.boolean().default(false),
  scope: z.record(z.string().max(80), z.string().max(MAX_SCOPE)).default({}),
  /** Progress notes the contractor approves for the customer. Empty by default. */
  notes: z.string().max(MAX_NOTES).default(""),
  /** Logo and brand color. Company name and contact details are always shown. */
  branding: z.boolean().default(true),
}).strict();
export type ReportOptions = z.infer<typeof reportOptionsSchema>;
export const DEFAULT_REPORT_OPTIONS: ReportOptions = reportOptionsSchema.parse({});

export type ReportState = "completed" | "current" | "upcoming";

export interface ReportTask { name: string; plannedStart: string; plannedEnd: string; actualFinish: string | null; status: TaskStatus; statusLabel: string }

export interface ReportSection {
  /** The section task's id: used only to compare with an earlier update. */
  key: string;
  name: string;
  trade: string | null;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualFinish: string | null;
  status: TaskStatus;
  statusLabel: string;
  state: ReportState;
  progress: number | null;
  scope: string | null;
  /** Who's doing the work (V4.2), already limited by the project's report setting. Absent in older reports. */
  assignedTo?: string | null;
  /** What changed since the last published update, in plain words. */
  change: string | null;
  tasks: ReportTask[] | null;
}

export interface CustomerReport {
  v: number;
  company: { name: string; phone: string | null; email: string | null; website: string | null };
  brand: { logo: boolean; color: string | null };
  customerName: string;
  projectTitle: string;
  projectAddress: string | null;
  /** Calendar date in the schedule's time zone. */
  reportDate: string;
  provisional: boolean;
  progress: number | null;
  projectStart: string | null;
  forecastFinish: string | null;
  /** Forecast finish in the last published update, when it was different. */
  previousForecast: string | null;
  showTimeline: boolean;
  sections: ReportSection[];
  notes: string | null;
  /** Counts per state, including hidden ones, so the customer view can say what it leaves out. */
  counts: Record<ReportState, number>;
}

export interface ReportContext {
  company: { name: string; phone?: string | null; email?: string | null; website?: string | null; color?: string | null; hasLogo?: boolean };
  today: string;
  tradeLabel?: (trade: string) => string;
  /** The last published report, to describe what changed. */
  previous?: CustomerReport | null;
  /** Section task id → the customer-safe "who's doing it" line (see reportAssignee in lib/projects/team). */
  assignees?: Record<string, string>;
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (s: string | null | undefined, max: number) => (s ?? "").replace(/\r\n?/g, "\n").replace(CONTROL, "").trim().slice(0, max);
const oneLine = (s: string | null | undefined, max = 200) => clean(s, max).replace(/\s+/g, " ");

/** Customer wording. "Not started" work that hasn't reached its start date reads as "Scheduled". */
export function customerStatus(status: TaskStatus, state: ReportState): string {
  if (status === "complete") return "Complete";
  if (status === "in_progress") return "In progress";
  if (status === "delayed") return "Delayed";
  if (status === "on_hold") return "On hold";
  return state === "upcoming" ? "Scheduled" : "Not started";
}

/**
 * Completed only when the contractor recorded it complete (which needs an actual finish date).
 * Upcoming: not started and its start date is still ahead. Everything else is current work, including
 * work that has passed its planned finish without being marked complete.
 */
export function stateOf(t: Pick<Task, "status" | "plannedStart" | "actualStart">, today: string): ReportState {
  if (t.status === "complete") return "completed";
  if (t.status !== "in_progress" && !t.actualStart && t.plannedStart > today) return "upcoming";
  return "current";
}

/** Initial scope summary for a section: its line item names from the frozen estimate (no quantities). */
export function defaultScopeText(data: Pick<ScheduleData, "snapshot">, section: Pick<Task, "sourceGroupId">): string {
  const src = data.snapshot.sections.find((s) => s.id === section.sourceGroupId);
  return clean((src?.items ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.name).filter(Boolean).join(", "), MAX_SCOPE);
}

function changeText(sec: { key: string; plannedStart: string; plannedEnd: string; status: TaskStatus }, prev: CustomerReport | null | undefined): string | null {
  const p = prev?.sections.find((s) => s.key === sec.key);
  if (!p) return null;
  if (sec.status === "complete" && p.status !== "complete") return "Completed since the last update.";
  if (sec.status === "complete") return null;
  if (p.plannedEnd !== sec.plannedEnd) return `Finish ${sec.plannedEnd > p.plannedEnd ? "moved later" : "moved earlier"}: was ${formatDay(p.plannedEnd)}, now ${formatDay(sec.plannedEnd)}.`;
  if (p.plannedStart !== sec.plannedStart) return `Start ${sec.plannedStart > p.plannedStart ? "moved later" : "moved earlier"}: was ${formatDay(p.plannedStart)}, now ${formatDay(sec.plannedStart)}.`;
  return null;
}

/** Builds the customer-visible report from the saved schedule. Pure: same input, same report. */
export function buildCustomerReport(data: ScheduleData, rawOptions: Partial<ReportOptions>, ctx: ReportContext): CustomerReport {
  const o = reportOptionsSchema.parse(rawOptions ?? {});
  const { tasks, snapshot, schedule } = data;
  const today = ctx.today;
  const heads = tasks.filter((t) => t.kind === "section" && !t.splitFrom).sort((a, b) => a.sortOrder - b.sortOrder || a.plannedStart.localeCompare(b.plannedStart));

  // Trade labels only help on multi-trade projects.
  const multiTrade = new Set(heads.map((h) => snapshot.sections.find((x) => x.id === h.sourceGroupId)?.trade ?? null)).size > 1;
  const counts: Record<ReportState, number> = { completed: 0, current: 0, upcoming: 0 };
  const sections: ReportSection[] = [];
  for (const h of heads) {
    // Everything that belongs to the section: its split parts, its line items and their split parts.
    const parts = tasks.filter((t) => t.id === h.id || t.splitFrom === h.id);
    const partIds = new Set(parts.map((p) => p.id));
    const items = tasks.filter((t) => t.kind === "item" && (t.parentId && partIds.has(t.parentId)))
      .flatMap((i) => [i, ...tasks.filter((x) => x.splitFrom === i.id)]);
    const all = [...parts, ...items];
    const plannedStart = all.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), h.plannedStart);
    const plannedEnd = all.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), h.plannedEnd);
    const actualStarts = all.map((t) => t.actualStart).filter(Boolean) as string[];
    const state = stateOf({ status: h.status, plannedStart, actualStart: actualStarts[0] ?? null }, today);
    counts[state]++;
    if ((state === "completed" && !o.showCompleted) || (state === "current" && !o.showCurrent) || (state === "upcoming" && !o.showUpcoming)) continue;

    const trade = multiTrade ? snapshot.sections.find((s) => s.id === h.sourceGroupId)?.trade ?? null : null;
    const scopeText = o.showScope && Object.prototype.hasOwnProperty.call(o.scope, h.id) ? clean(o.scope[h.id], MAX_SCOPE) : "";
    const itemHeads = items.filter((i) => !i.splitFrom).sort((a, b) => a.sortOrder - b.sortOrder || a.plannedStart.localeCompare(b.plannedStart));
    sections.push({
      key: h.id,
      name: oneLine(h.name),
      trade: trade ? oneLine(ctx.tradeLabel ? ctx.tradeLabel(trade) : trade, 80) : null,
      plannedStart, plannedEnd,
      actualStart: actualStarts.length ? actualStarts.sort()[0] : null,
      // Only a recorded completion carries an actual finish.
      actualFinish: h.status === "complete" ? h.actualFinish : null,
      status: h.status,
      statusLabel: customerStatus(h.status, state),
      state,
      progress: o.showProgress ? sectionProgress(tasks, h.id, schedule.progressMethod) : null,
      scope: scopeText || null,
      ...(ctx.assignees?.[h.id] ? { assignedTo: oneLine(ctx.assignees[h.id], 300) } : {}),
      change: changeText({ key: h.id, plannedStart, plannedEnd, status: h.status }, ctx.previous),
      tasks: o.showTaskDetails && itemHeads.length
        ? itemHeads.map((i) => {
          const segs = [i, ...tasks.filter((x) => x.splitFrom === i.id)];
          const st = stateOf(i, today);
          return {
            name: oneLine(i.name), plannedStart: segs.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), i.plannedStart),
            plannedEnd: segs.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), i.plannedEnd),
            actualFinish: i.status === "complete" ? i.actualFinish : null, status: i.status, statusLabel: customerStatus(i.status, st),
          };
        })
        : null,
    });
  }

  const forecastFinish = tasks.length ? finishOf(tasks) : null;
  const previousForecast = ctx.previous?.forecastFinish && forecastFinish && ctx.previous.forecastFinish !== forecastFinish ? ctx.previous.forecastFinish : null;
  const color = ctx.company.color && /^#[0-9a-f]{6}$/i.test(ctx.company.color) ? ctx.company.color : null;
  return {
    v: REPORT_VERSION,
    company: {
      name: oneLine(ctx.company.name) || "Your contractor",
      phone: oneLine(ctx.company.phone, 50) || null,
      email: oneLine(ctx.company.email, 320) || null,
      website: oneLine(ctx.company.website, 200) || null,
    },
    brand: { logo: o.branding && Boolean(ctx.company.hasLogo), color: o.branding ? color : null },
    customerName: oneLine(snapshot.estimate.customerName),
    projectTitle: oneLine(snapshot.estimate.title || schedule.name),
    projectAddress: oneLine(snapshot.estimate.projectAddress, 300) || null,
    reportDate: today,
    provisional: schedule.provisional,
    progress: o.showProgress ? progressOf(tasks, schedule.progressMethod).percent : null,
    projectStart: tasks.length ? tasks.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), tasks[0].plannedStart) : null,
    forecastFinish,
    previousForecast,
    showTimeline: o.showTimeline,
    sections,
    notes: clean(o.notes, MAX_NOTES) || null,
    counts,
  };
}

/** Customer email for a published update, sent by the contractor from their own email. */
export function buildUpdateEmail(r: CustomerReport, opts: { link?: string | null; contactName?: string | null } = {}): { subject: string; body: string } {
  const company = r.company.name;
  const project = r.projectTitle;
  const first = r.customerName.split(" ")[0]?.replace(/[,;]+$/, "") ?? "";
  const link = opts.link && /^https?:\/\/\S+$/.test(opts.link) ? opts.link : "";
  const lines = [first.length >= 2 ? `Hi ${first},` : "Hi,", "", `Here's the latest schedule update for ${project || "your project"}.`];
  const facts = [
    r.progress !== null ? `Overall progress: ${r.progress}% complete.` : "",
    r.forecastFinish ? `Forecast completion: ${formatDay(r.forecastFinish, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${r.previousForecast ? ` (previously ${formatDay(r.previousForecast, { month: "long", day: "numeric" })})` : ""}.` : "",
  ].filter(Boolean);
  if (facts.length) lines.push("", ...facts);
  lines.push("", link ? "You can view the full update here:" : "The full update is attached as a PDF.");
  if (link) lines.push("", link);
  lines.push("", "Please let me know if you have any questions.", "", "Thank you,", ...[oneLine(opts.contactName), company].filter((v, i, a) => v && a.indexOf(v) === i));
  return { subject: project ? `Project update: ${project} — ${company}` : `Project update from ${company}`, body: lines.join("\n") };
}

export const DELIVERY_METHODS = ["pdf_download", "email_draft", "share_sheet", "link_created", "link_copied"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
/** History wording. An opened email draft is not a delivered email, so it never says "sent". */
export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  pdf_download: "PDF downloaded",
  email_draft: "Email draft opened (you send it)",
  share_sheet: "Shared from this device",
  link_created: "Secure link created",
  link_copied: "Link copied",
};

export function reportFilename(r: Pick<CustomerReport, "company" | "projectTitle" | "reportDate">, version?: number): string {
  const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "project";
  return `${slug(r.company.name)}_${slug(r.projectTitle)}_update${version ? `-${version}` : ""}_${r.reportDate}.pdf`;
}
