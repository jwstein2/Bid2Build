/**
 * Pure rules for which time entries go to QuickBooks and what each one becomes (a QuickBooks TimeActivity).
 * Only approved, closed, paid entries for workers matched to a QuickBooks employee or vendor are sent, once each.
 * Hours are clock time minus the unpaid break; paid breaks stay in, as in the payroll CSV.
 */
import { entryHours, localDay, type TimeEntry } from "@/lib/team/records";

export interface WorkerLink { resourceId: string; qbType: "Employee" | "Vendor"; qbId: string; qbName: string | null }
export interface JobLink { scheduleId: string; qbCustomerId: string; qbName: string | null }

export type SkipReason = "not_approved" | "still_open" | "unpaid" | "no_match" | "already_sent" | "zero_hours";

export interface Plan {
  send: { entry: TimeEntry; hours: number; txnDate: string; payload: TimeActivityPayload }[];
  skipped: Record<SkipReason, number>;
}

export interface TimeActivityPayload {
  NameOf: "Employee" | "Vendor";
  EmployeeRef?: { value: string };
  VendorRef?: { value: string };
  CustomerRef?: { value: string };
  TxnDate: string;
  Hours: number;
  Minutes: number;
  BillableStatus: "NotBillable";
  Description: string;
}

/** Whole hours and minutes, rounded to the nearest minute. */
export function splitHours(hours: number): { Hours: number; Minutes: number } {
  const total = Math.max(0, Math.round(hours * 60));
  return { Hours: Math.floor(total / 60), Minutes: total % 60 };
}

export function buildPayload(entry: TimeEntry, worker: WorkerLink, job: JobLink | undefined, tz: string, projectName?: string): { payload: TimeActivityPayload; hours: number; txnDate: string } {
  const hours = Math.round(entryHours(entry) * 100) / 100;
  const txnDate = localDay(entry.clockIn, tz);
  const desc = ["Built2Bid time entry", projectName ? `· ${projectName}` : "", entry.note ? `· ${entry.note}` : ""].filter(Boolean).join(" ").slice(0, 4000);
  const payload: TimeActivityPayload = {
    NameOf: worker.qbType,
    ...(worker.qbType === "Employee" ? { EmployeeRef: { value: worker.qbId } } : { VendorRef: { value: worker.qbId } }),
    ...(job ? { CustomerRef: { value: job.qbCustomerId } } : {}),
    TxnDate: txnDate,
    ...splitHours(hours),
    BillableStatus: "NotBillable",
    Description: desc,
  };
  return { payload, hours, txnDate };
}

export function planExport(entries: TimeEntry[], opts: { workers: WorkerLink[]; jobs: JobLink[]; sent: Set<string>; tz: string; projects?: Record<string, string>; days?: { from: string; to: string } }): Plan {
  const workers = new Map(opts.workers.map((w) => [w.resourceId, w]));
  const jobs = new Map(opts.jobs.map((j) => [j.scheduleId, j]));
  const skipped: Record<SkipReason, number> = { not_approved: 0, still_open: 0, unpaid: 0, no_match: 0, already_sent: 0, zero_hours: 0 };
  const send: Plan["send"] = [];
  for (const e of entries) {
    if (e.status === "rejected") continue;
    if (opts.days) { const d = localDay(e.clockIn, opts.tz); if (d < opts.days.from || d > opts.days.to) continue; }
    if (!e.clockOut || e.status === "open") { skipped.still_open++; continue; }
    if (e.status !== "approved") { skipped.not_approved++; continue; }
    if (e.workCategory === "unpaid") { skipped.unpaid++; continue; }
    if (opts.sent.has(e.id)) { skipped.already_sent++; continue; }
    const w = workers.get(e.resourceId);
    if (!w) { skipped.no_match++; continue; }
    const job = e.scheduleId ? jobs.get(e.scheduleId) : undefined;
    const b = buildPayload(e, w, job, opts.tz, e.scheduleId ? opts.projects?.[e.scheduleId] : undefined);
    if (b.payload.Hours === 0 && b.payload.Minutes === 0) { skipped.zero_hours++; continue; }
    send.push({ entry: e, ...b });
  }
  send.sort((a, b) => a.entry.clockIn.localeCompare(b.entry.clockIn));
  return { send, skipped };
}

/** A short, safe message from a QuickBooks Fault response (never echoes tokens). */
export function faultMessage(body: unknown): string {
  const f = (body as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } } | null)?.Fault?.Error?.[0];
  const msg = [f?.Message, f?.Detail].filter(Boolean).join(": ");
  return (msg || "QuickBooks didn't accept this entry.").slice(0, 300);
}
