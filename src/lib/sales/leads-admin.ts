/**
 * V8.6 lead distribution, master CRM and rep lifecycle: labels and pure helpers shared by the Admin
 * Sales Hub pages and actions. The rules themselves live in the database (20270121001000).
 */

export const HOLD_LABEL: Record<string, string> = {
  unassigned: "Unassigned",
  no_eligible_rep: "No eligible rep right now",
  possible_duplicate: "Possible duplicate",
  validation: "Needs a fix before assigning",
  admin_hold: "On hold",
  needs_classification: "Needs a trade or location",
  manual: "Returned to the queue",
  existing_customer: "Already a Built2Bid customer",
  recycle_no_alternative: "Recycled, waiting for another rep",
  recycle_review: "Recycled too many times: review",
  dormant: "Dormant (parked)",
};

/** V8.7 lead recycling labels. */
export const RECYCLE_RULE: Record<string, string> = {
  first_contact: "No first contact yet", overdue_followup: "Follow-up overdue", owner_inactive: "Owner no longer active",
};
export const RECYCLE_REASON: Record<string, string> = {
  first_contact: "No first contact in time", overdue_followup: "Follow-up overdue", owner_inactive: "Owner no longer active", admin: "Recycled by an admin", returned: "Handed back by the rep",
};
export const RECYCLE_OUTCOME: Record<string, string> = { reassigned: "Reassigned", no_alternative: "Waiting for another rep", review: "Sent to review" };
export const RECYCLE_PROTECTED: Record<string, string> = {
  customer_or_closed: "Customer, trial or closed", contact_restricted: "Do not contact", admin_hold: "On recycling hold", appointment: "Appointment booked",
  offboarding: "Owner is offboarding", time_off: "Owner on time off", disputed: "Under review",
};
export const CONTACT_LEVEL: Record<string, string> = { none: "Not contacted", attempted: "Attempted", delivered: "Delivered", two_way: "Two-way contact", opportunity: "Active opportunity" };

/** Hours (or days) left until a deadline, in plain words. Negative = overdue. */
export function untilLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - now;
  const h = Math.round(Math.abs(ms) / 3_600_000);
  const words = h < 1 ? "under an hour" : h < 48 ? `${h} hour${h === 1 ? "" : "s"}` : `${Math.round(h / 24)} days`;
  return ms >= 0 ? `in ${words}` : `${words} overdue`;
}

/** Recycling history rows as CSV (formula-safe). */
export function recycleCsv(rows: { at: string; company_name: string; reason: string; outcome: string; cycle: number; from: string | null; to: string | null; note: string | null }[]): string {
  const cell = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["When", "Business", "Reason", "Outcome", "Cycle", "From", "To", "Note"];
  return [head, ...rows.map((r) => [r.at, r.company_name, RECYCLE_REASON[r.reason] ?? r.reason, RECYCLE_OUTCOME[r.outcome] ?? r.outcome, r.cycle, r.from, r.to, r.note])]
    .map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

export const ORIGIN_LABEL: Record<string, string> = {
  company: "Company lead", rep_sourced: "Rep's own lead", referral: "Referral (rep link)", customer: "Existing customer", historical: "Historical contact",
};

export const METHOD_LABEL: Record<string, string> = {
  auto: "Automatic (round robin)", manual: "Assigned by an admin", bulk: "Bulk assignment", self: "Admin took it", unassign: "Returned to the queue",
  offboarding: "Moved during offboarding", rep_sourced: "Rep added it", import: "Imported", recycle: "Recycled", merge: "Merged", legacy: "Earlier change",
};

export const WARNING_LABEL: Record<string, string> = {
  active_conversation: "contacted in the last 14 days",
  upcoming_meeting: "has an upcoming meeting",
  open_follow_up: "has an open follow-up",
  pending_proposal: "is in demo or trial",
  customer: "is a customer",
  commission_attribution: "has commission attribution (it stays with the original rep)",
};

export const DISPOSITIONS: Record<string, { v: string; label: string }[]> = {
  call: [{ v: "connected", label: "Talked to them" }, { v: "voicemail", label: "Left a voicemail" }, { v: "no_answer", label: "No answer" }, { v: "busy", label: "Busy" }, { v: "wrong_number", label: "Wrong number" }],
  email: [{ v: "sent", label: "Sent" }, { v: "bounced", label: "Bounced back" }, { v: "failed", label: "Didn't send" }],
  text: [{ v: "sent", label: "Sent" }, { v: "failed", label: "Didn't send" }],
  meeting: [{ v: "scheduled", label: "Scheduled" }, { v: "held", label: "Held" }, { v: "no_show", label: "No-show" }],
};
export const DISPOSITION_LABEL: Record<string, string> = Object.fromEntries(Object.values(DISPOSITIONS).flat().map((d) => [d.v, d.label]));

export const REASON_CATEGORIES: Record<string, string> = {
  voluntary: "Voluntary departure", contract_expired: "Contract ended", inactivity: "Inactivity", performance: "Performance concerns",
  policy_violation: "Policy violation", restructuring: "Business restructuring", admin_error: "Added by mistake", other: "Other",
};

export const LEAD_PLANS: Record<string, string> = {
  equal: "Share evenly across eligible reps", trade: "Reps who cover the lead's trade", territory: "Reps who cover the lead's state", rep: "One rep I choose", manual: "I'll assign them myself",
};

export const DELIVERY_LABEL: Record<string, string> = {
  not_sent: "Not emailed (link made to send yourself)", queued: "Queued", accepted: "Accepted by the email provider (not yet confirmed delivered)",
  delivered: "Delivered to their mail server", bounced: "Bounced", failed: "Didn't send",
};

export interface ManagedRep {
  status: string; linked: boolean; allocation_paused: boolean; reactivated_at: string | null; on_time_off?: boolean;
}
export type Lifecycle = "invited" | "onboarding" | "active" | "paused" | "suspended" | "offboarding" | "offboarded" | "reactivated";

/** One label for where a rep is in their lifecycle. Access comes from status; the rest are layers on top. */
export function lifecycle(r: ManagedRep, offboarding: boolean, certified?: boolean): Lifecycle {
  if (r.status === "removed") return "offboarded";
  if (offboarding) return "offboarding";
  if (r.status === "suspended") return "suspended";
  if (r.status === "invited" || !r.linked) return "invited";
  if (r.allocation_paused) return "paused";
  if (certified === false) return "onboarding";
  if (r.reactivated_at) return "reactivated";
  return "active";
}
export const LIFECYCLE: Record<Lifecycle, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "brand" | "accent" }> = {
  invited: { label: "Invited", tone: "accent" }, onboarding: { label: "Onboarding", tone: "brand" }, active: { label: "Active", tone: "ok" },
  paused: { label: "Leads paused", tone: "warn" }, suspended: { label: "Suspended", tone: "danger" }, offboarding: { label: "Offboarding", tone: "warn" },
  offboarded: { label: "Offboarded", tone: "neutral" }, reactivated: { label: "Reactivated", tone: "ok" },
};

export const LEAD_FILTERS = ["q", "trade", "state", "stage", "owner", "origin", "follow", "contact", "dup"] as const;
export type LeadFilters = Partial<Record<(typeof LEAD_FILTERS)[number], string>>;

/** Keeps only known filters with sane values (they go into a database call). */
export function cleanFilters(sp: Record<string, string | undefined>): LeadFilters {
  const out: LeadFilters = {};
  const ok: Record<string, (v: string) => boolean> = {
    q: (v) => v.length <= 100, trade: (v) => /^[a-z ]{1,40}$/.test(v), state: (v) => /^[A-Za-z]{2}$/.test(v),
    stage: (v) => ["new", "contacted", "engaged", "demo", "trial", "paying", "lost"].includes(v),
    owner: (v) => v === "none" || v === "held" || /^[0-9a-f-]{36}$/i.test(v), origin: (v) => v in ORIGIN_LABEL,
    follow: (v) => ["overdue", "today", "week", "none"].includes(v), contact: (v) => ["7", "30", "never"].includes(v), dup: (v) => ["seen_again", "possible"].includes(v),
  };
  for (const k of LEAD_FILTERS) {
    const v = (sp[k] ?? "").trim();
    if (v && ok[k](v)) out[k] = k === "state" ? v.toUpperCase() : v;
  }
  return out;
}

export function filterQuery(f: LeadFilters, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ tab: "leads" });
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

/** "3 days" style age for the queue. */
export function ageLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const h = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 3_600_000));
  if (h < 24) return h <= 1 ? "under an hour" : `${h} hours`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
}

/** Comma/semicolon list of 2-letter states or trades from a form field. */
export function listField(v: FormDataEntryValue | null, kind: "state" | "trade"): string[] {
  return [...new Set(String(v ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
    .map((s) => (kind === "state" ? s.toUpperCase() : s.toLowerCase()))
    .filter((s) => (kind === "state" ? /^[A-Z]{2}$/.test(s) : s.length <= 40)))].slice(0, 60);
}

/** Lead import columns from a CSV header (any order, common names). Falls back to the fixed paste order. */
const HEADER: Record<string, string> = {
  company: "company_name", company_name: "company_name", business: "company_name", business_name: "company_name", name: "company_name",
  contact: "contact_name", contact_name: "contact_name", owner: "contact_name", owner_name: "contact_name",
  email: "email", phone: "phone", website: "website", url: "website", city: "city", state: "state", zip: "zip", zip_code: "zip", postal_code: "zip",
  trades: "trades", trade: "trades", notes: "notes",
};
export function csvToRows(text: string, max = 1000): Record<string, string | string[]>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const cells = (l: string) => (l.includes("\t") ? l.split("\t") : splitCsvLine(l)).map((c) => c.trim());
  const head = cells(lines[0]).map((h) => HEADER[h.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")] ?? "");
  if (!head.includes("company_name")) return [];
  const out: Record<string, string | string[]>[] = [];
  for (const l of lines.slice(1)) {
    const c = cells(l);
    const r: Record<string, string | string[]> = {};
    head.forEach((k, i) => { if (k && c[i]) r[k] = k === "trades" ? c[i].split(/[;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean) : c[i]; });
    if (r.company_name) out.push(r);
    if (out.length >= max) break;
  }
  return out;
}
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

export const ADMIN_LEAD_ERRORS: Record<string, string> = {
  no_rep_profile: "You don't have a selling profile, so leads can't be assigned to you. Pick a rep instead.",
  rep_not_found: "Pick an active rep who sells.",
  invalid_mode: "Pick what to do with the selected leads.",
  already_decided: "Someone already decided that row.",
  invalid_rows: "Add 1 to 1,000 rows with a company name.",
  assign_first: "Assign the lead to a rep first; follow-ups belong to the lead's owner.",
  invalid_disposition: "Pick an outcome that fits the activity.",
  do_not_contact: "That business asked not to be contacted.",
  dnc_listed: "That number is on the Do Not Call Registry. No calls or texts.",
  dnc_unchecked: "Record a Do Not Call Registry check before calling or texting.",
  text_needs_consent: "Texts need the prospect's written consent on file.",
  outside_calling_hours: "It's outside calling hours (9 AM to 8 PM) where the business is.",
  sent_recently: "An invitation went out in the last 10 minutes. Give it a few minutes before sending another.",
  owner_only: "Only the platform owner can change an administrator.",
  cannot_edit_self: "You can't change your own team record. Ask the platform owner.",
  reason_required: "Add a short reason (it's kept in the audit log).",
  invalid_transition: "That change doesn't apply to this rep right now.",
  offboarding_open: "Finish or cancel the open offboarding first.",
  review_incomplete: "Complete every review step (commissions, rewards, agreement, final payout, tax records) before finishing.",
  agreement_required: "Confirm the rep has a current agreement on file before reactivating.",
  duplicate: "Someone with that email is already on the sales team.",
  invalid_date: "Pick an effective date.",
  already_joined: "That person already signed in, so they don't need an invite.",
  use_offboarding: "Use Offboard on the rep's management page to remove someone, so their records and pay are handled properly.",
  send_failed: "The invitation email didn't send. The new link is shown below so you can send it yourself.",
  already_disputed: "A review was already requested for this lead.",
  cannot_return: "Only company leads that aren't customers or trials can be handed back.",
  rep_not_eligible: "That rep can't take leads right now.",
  note_required: "Add a short note.",
  not_authorized: "Your role can't do that.",
  invalid: "Check the form and try again.",
};
