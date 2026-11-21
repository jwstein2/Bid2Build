/**
 * Contract payment milestones -> expected invoice date -> expected payment date (pure).
 *
 * The signed payment schedule (fin_payment_milestones) is the authority; this never changes it. For a milestone not
 * invoiced yet the expected invoice date is:
 *   ready to invoice (trigger recorded)  -> today
 *   due on signing / on a contract date  -> the signing (today) / that date
 *   project start                        -> the schedule's projected start
 *   a progress rule ("at 30% complete")  -> the day the schedule is projected to reach 30% verified progress
 *   final completion                     -> the schedule's projected finish
 *   a phase with no progress rule        -> the projected finish, flagged low confidence (link it to a % to improve it)
 * Then the due date follows the milestone's due rule (on receipt / net N days / a date), and the payment date follows the
 * customer's collection rule. Progress that has reached a rule's threshold is only "eligible": a person confirms it.
 */
import { collectionRule, projectPayment, scenarioRule, type CollectionOverride, type CustomerHistory } from "./collections";
import { addDays, maxD, shortDate } from "./dates";
import { projectThreshold, type Projection, type ScheduleInput, type WeightMethod } from "./schedule";
import type { CashSettings, Scenario } from "./settings";
import type { ExtraFlowV9 } from "./types";

export interface MilestoneRow {
  id: string; jobId: string; jobName: string; customerId: string | null; seq: number; description: string; triggerKind: string;
  dueRule: string; dueDays: number | null; dueOn: string | null; amount: number; invoiced: number; state: string; triggeredAt: string | null;
}
export interface ProgressRule { milestoneId: string; threshold: number; method: WeightMethod; sectionKey: string | null }

export interface MilestoneProjection {
  milestoneId: string; jobId: string; jobName: string; description: string; amount: number;
  invoiceOn: string | null; dueOn: string | null; payOn: string | null; basis: string; confidence: "high" | "medium" | "low";
  rule: ProgressRule | null; progress: number | null; eligible: boolean; triggered: boolean; text: string;
}

export function projectMilestone(m: MilestoneRow, rule: ProgressRule | null, schedule: ScheduleInput | null, projection: Projection | null,
  s: CashSettings, history: Record<string, CustomerHistory>, overrides: Record<string, CollectionOverride>, today: string, scenario: Scenario = "expected"): MilestoneProjection {
  const remaining = Math.max(0, m.amount - m.invoiced);
  let invoiceOn: string | null = null; let basis = ""; let confidence: MilestoneProjection["confidence"] = "medium";
  let progress: number | null = null; let eligible = false;
  const triggered = m.state !== "not_triggered";
  if (triggered) { invoiceOn = today; basis = m.triggeredAt ? `Ready to invoice since ${shortDate(m.triggeredAt.slice(0, 10))}` : "Ready to invoice"; confidence = "high"; }
  else if (m.triggerKind === "agreement_signed") { invoiceOn = today; basis = "Due on signing"; confidence = "high"; }
  else if (m.triggerKind === "calendar_date" && m.dueOn) { invoiceOn = m.dueOn; basis = `Contract date ${shortDate(m.dueOn)}`; confidence = "high"; }
  else if (rule && schedule) {
    const t = projectThreshold(schedule, rule.threshold, today, rule.method, rule.sectionKey);
    progress = t.progress; eligible = t.reached;
    invoiceOn = t.date;
    basis = t.reached ? `Verified progress ${t.progress}% has reached the ${rule.threshold}% milestone: confirm it to invoice`
      : `Schedule projected to reach ${rule.threshold}% ${t.date ? `on ${shortDate(t.date)}` : ""} (now ${t.progress}%${t.slipDays ? `, ${t.slipDays} days behind plan` : ""})`;
    confidence = schedule.status === "draft" ? "low" : t.reached ? "high" : "medium";
  } else if (m.triggerKind === "project_start_confirmed" && projection?.start) {
    invoiceOn = maxD(projection.start, today); basis = `Projected start ${shortDate(invoiceOn)}`;
  } else if (projection?.projectedEnd) {
    invoiceOn = projection.projectedEnd;
    basis = m.triggerKind === "final_completion_confirmed" ? `Projected finish ${shortDate(invoiceOn)}${projection.slipDays ? ` (${projection.slipDays} days behind plan)` : ""}`
      : `No progress rule: assumed at the projected finish ${shortDate(invoiceOn)}. Link it to a schedule % for a better date.`;
    confidence = m.triggerKind === "final_completion_confirmed" ? "medium" : "low";
  } else if (m.dueOn) { invoiceOn = m.dueOn; basis = `Due ${shortDate(m.dueOn)}`; confidence = "low"; }
  if (!invoiceOn || remaining <= 0) {
    return { milestoneId: m.id, jobId: m.jobId, jobName: m.jobName, description: m.description, amount: remaining, invoiceOn: null, dueOn: null, payOn: null,
      basis: basis || "No date: the job has no schedule and the milestone has no contract date", confidence: "low", rule, progress, eligible, triggered, text: basis };
  }
  const dueOn = m.dueRule === "date" && m.dueOn ? m.dueOn : m.dueRule === "net_days" && m.dueDays !== null ? addDays(invoiceOn, m.dueDays) : invoiceOn;
  const cr = scenarioRule(collectionRule(m.customerId, s, history, overrides), scenario, s);
  const pay = projectPayment(invoiceOn, dueOn, cr, today);
  if (cr.confidence === "low" && confidence === "high") confidence = "medium";
  return { milestoneId: m.id, jobId: m.jobId, jobName: m.jobName, description: m.description, amount: remaining, invoiceOn, dueOn, payOn: pay.date, basis, confidence,
    rule, progress, eligible, triggered,
    text: `Expected invoice ${shortDate(invoiceOn)} (${basis}). Due ${shortDate(dueOn)}. ${pay.text}` };
}

export function milestoneFlow(p: MilestoneProjection): ExtraFlowV9 | null {
  if (!p.payOn || p.amount <= 0) return null;
  return { key: `ms:${p.milestoneId}`, label: `${p.jobName} · ${p.description}`, amount: p.amount.toFixed(2), category: "milestone", scheduledOn: null, expectedOn: p.payOn,
    href: `/financials/jobs/${p.jobId}#fin-milestones`, jobId: p.jobId, source: "milestone", note: `Not invoiced yet. ${p.text}` };
}
