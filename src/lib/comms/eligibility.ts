/**
 * Who may receive a nurture follow-up, and when. Pure: the server loads the rows, this decides.
 *
 * Rules (deliberately conservative):
 *   * One entry per email address per account, however many bids or projects it appears on.
 *   * Nobody with work in progress (won / scheduled / in progress, a live schedule) or a proposal sent
 *     in the last 30 days: they get project updates or a normal sales follow-up, not nurture.
 *   * Older drafts alone never qualify on their own: the contractor must confirm the relationship.
 *   * Any suppression (unsubscribe, STOP, bounce, complaint) or a paused / replied contact excludes.
 *   * Next follow-up = the later of the last real interaction and the last follow-up, plus N months.
 */
import { addMonths } from "./time";
import type { AudienceGroup, Basis, ContactStatus } from "./types";
import { normalizeEmail } from "./types";

export interface EstimateFact {
  id: string;
  customerId: string | null;
  email: string | null;
  name: string;
  title: string;
  trades: string[];
  estimateDate: string;         // YYYY-MM-DD
  updatedAt: string;
  stage: string;                // pipeline_stage
  stageChangedAt: string | null;
  scheduleStatus: string | null; // draft | active | completed | archived
  scheduleUpdatedAt: string | null;
}
export interface ContactFact {
  id: string; email: string; status: ContactStatus; basis: Basis; lastNurtureAt: string | null; lastReplyAt: string | null; enrolledAt: string;
  /** Relationship confirmed for a draft-only person, but not enrolled yet (doesn't count as paused). */
  pending?: boolean;
}
export interface SuppressionFact { accountId: string | null; email: string; scope: "marketing" | "project_updates" | "all"; reason: string }

export interface AudienceEntry {
  email: string;
  name: string;
  customerId: string | null;
  groups: AudienceGroup[];
  basis: Basis | null;
  /** The estimate the follow-up talks about (most recent relevant one). */
  estimate: { id: string; title: string; trades: string[]; estimateDate: string; stage: string; completed: boolean };
  estimateCount: number;
  lastInteractionAt: string;
  nextDueAt: string;
  due: boolean;
  contactId: string | null;
  contactStatus: ContactStatus | null;
  /** Why this person can't be enrolled / emailed (null = eligible). */
  excluded: string | null;
}

const DAY = 86_400_000;
const ACTIVE_STAGES = new Set(["won", "scheduled", "in_progress"]);
const OPEN_STAGES = new Set(["sent", "pending"]);
const DRAFT_STAGES = new Set(["draft", "ready_for_review", "approved"]);
const max = (...d: (string | null | undefined)[]) => d.filter(Boolean).sort().at(-1) as string;

const SUPPRESSION_TEXT: Record<string, string> = {
  unsubscribe: "Unsubscribed", stop_request: "Asked not to be contacted", ambiguous_opt_out: "Possible opt-out (kept off to be safe)",
  bounce: "Email address bounced", complaint: "Marked an email as spam", manual: "Suppressed by your team",
};
const STATUS_TEXT: Partial<Record<ContactStatus, string>> = {
  paused: "Paused by your team", replied: "Replied: follow-ups stay off until you resume them", unsubscribed: "Unsubscribed", bounced: "Email address bounced", suppressed: "Suppressed",
};

export function isSuppressed(supp: SuppressionFact[], accountId: string, email: string, kind: "marketing" | "project_updates"): SuppressionFact | null {
  return supp.find((s) => s.email === email && (s.accountId === null || s.accountId === accountId) && (s.scope === "all" || s.scope === kind)) ?? null;
}

export function buildAudience(input: {
  accountId: string; estimates: EstimateFact[]; contacts: ContactFact[]; suppressions: SuppressionFact[]; now: Date; months: number;
}): AudienceEntry[] {
  const { now, months } = input;
  const nowMs = now.getTime();
  const byEmail = new Map<string, EstimateFact[]>();
  for (const e of input.estimates) {
    const email = normalizeEmail(e.email);
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push(e);
    byEmail.set(email, list);
  }
  const contacts = new Map(input.contacts.map((c) => [c.email, c]));
  const out: AudienceEntry[] = [];
  for (const [email, list] of byEmail) {
    const age = (iso: string | null) => (iso ? (nowMs - Date.parse(iso)) / DAY : 0);
    const isCompleted = (e: EstimateFact) => e.stage === "completed" || e.scheduleStatus === "completed";
    const active = list.some((e) => !isCompleted(e) && (ACTIVE_STAGES.has(e.stage) || e.scheduleStatus === "draft" || e.scheduleStatus === "active"));
    const recentOpen = list.some((e) => OPEN_STAGES.has(e.stage) && age(e.stageChangedAt ?? e.updatedAt) < 30);
    const groups = new Set<AudienceGroup>();
    for (const e of list) {
      if (isCompleted(e)) groups.add(age(e.scheduleUpdatedAt ?? e.stageChangedAt ?? e.updatedAt) <= 730 ? "completed" : "past_customer");
      else if (e.stage === "lost") groups.add("lost");
      else if (OPEN_STAGES.has(e.stage) && age(e.stageChangedAt ?? e.updatedAt) >= 30) groups.add("unconverted");
      else if (DRAFT_STAGES.has(e.stage) && age(e.updatedAt) >= 90) groups.add("old_draft");
    }
    const contact = contacts.get(email) ?? null;
    const basis: Basis | null = groups.has("completed") || groups.has("past_customer") ? "customer"
      : groups.has("lost") || groups.has("unconverted") ? "inquiry"
        : contact?.basis === "confirmed" ? "confirmed" : null;
    // The estimate to talk about: completed work first, then the most recently touched relevant bid.
    const rank = (e: EstimateFact) => (isCompleted(e) ? 3 : e.stage === "lost" || OPEN_STAGES.has(e.stage) ? 2 : 1);
    const pick = [...list].sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt))[0];
    const lastInteractionAt = max(...list.flatMap((e) => [e.updatedAt, e.stageChangedAt, e.scheduleUpdatedAt]), contact?.lastReplyAt);
    const nextDueAt = addMonths(new Date(max(lastInteractionAt, contact?.lastNurtureAt)), months).toISOString();
    const supp = isSuppressed(input.suppressions, input.accountId, email, "marketing");
    let excluded: string | null = null;
    if (supp) excluded = SUPPRESSION_TEXT[supp.reason] ?? "Suppressed";
    else if (contact && contact.status !== "eligible" && !contact.pending) excluded = STATUS_TEXT[contact.status] ?? "Not eligible";
    else if (active) excluded = "Has a project in progress (gets project updates instead)";
    else if (recentOpen) excluded = "Proposal sent in the last 30 days";
    else if (!groups.size) excluded = "No past bid or project that qualifies yet";
    else if (!basis) excluded = "Draft only: confirm you have a relationship with this person first";
    out.push({
      email, name: pick.name, customerId: list.find((e) => e.customerId)?.customerId ?? null,
      groups: [...groups], basis,
      estimate: { id: pick.id, title: pick.title, trades: pick.trades, estimateDate: pick.estimateDate, stage: pick.stage, completed: isCompleted(pick) },
      estimateCount: list.length, lastInteractionAt, nextDueAt, due: Date.parse(nextDueAt) <= nowMs,
      contactId: contact?.id ?? null, contactStatus: contact?.status ?? null, excluded,
    });
  }
  return out.sort((a, b) => Number(Boolean(a.excluded)) - Number(Boolean(b.excluded)) || a.nextDueAt.localeCompare(b.nextDueAt) || a.name.localeCompare(b.name));
}
