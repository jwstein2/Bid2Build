/** Compensation V3 shared types and messages (admin Compensation & payroll tab). */
export const COMP_ERRORS: Record<string, string> = {
  not_authorized: "Your role can't do that. Compensation programs and payroll are the platform owner's.",
  reason_required: "Add a short reason; it is kept in the program history.",
  approval_required: "Record a current, documented legal approval for at least one state before turning this program on.",
  approval_documentation_required: "An approval needs the legal memo or opinion reference and the reviewing attorney.",
  standard_not_toggleable: "Standard commissions can't be switched off with a program flag.",
  already_resolved: "That dispute was already resolved.",
  cannot_approve_own: "You can't resolve a dispute about your own pay. Another administrator or the owner has to.",
  invalid_milestones: "Pick a valid model and qualification rule.",
  invalid: "Check the form and try again.",
};

type Rule = { at: number; flat_cents?: number; pct?: number } | null;
type Program = { key: string; name: string; kind: string; enabled: boolean; requires_jurisdiction_approval: boolean; eligibility_ended_at: string | null; emergency_disabled_at: string | null; emergency_reason: string | null; unavailable_message: string; description: string | null };
export interface AdminCompensation {
  months: { month: string; revenue_cents: number; commission_cents: number; bonus_cents: number; paid_cents: number }[];
  reps: {
    rep_id: string; rep_name: string; status: string; work_state: string | null; work_locality: string | null; attributed: number; qualifying: number; active_paying: number;
    ever_paid: number; qualifying_mrr_cents: number; revenue_cents: number; commission_earned_cents: number; commission_pending_cents: number; bonus_earned_cents: number;
    bonus_paid_cents: number; bonus_pending_cents: number; paid_out_cents: number; obligation_cents: number; current: Rule; next: Rule; remaining: number;
  }[];
  awards: { id: string; rep_name: string; milestone: number; rule_set: string; pct: number; flat_cents: number | null; mrr_cents: number | null; revenue_cents: number | null; amount_cents: number | null; status: string; reached_at: string; policy_version: number | null; snapshot: Record<string, unknown> | null; snapshot_hash: string | null; hash_ok: boolean; void_reason: string | null; commission_status: string | null }[];
  disputes: { id: string; award_id: string; rep_name: string; milestone: number; note: string; status: string; resolution: string | null; adjustment_cents: number | null; created_at: string; resolved_at: string | null }[];
  adjustments: { action: string; at: string; details: Record<string, unknown> | null }[];
}
export interface AdminPrograms {
  programs: Program[];
  jurisdictions: { id: string; program_key: string; state: string; locality: string | null; status: string; legal_reference: string | null; reviewed_by: string | null; effective_from: string; expires_on: string | null; notes: string | null; revoked_at: string | null; revoke_reason: string | null; current: boolean }[];
  events: { id: number; program_key: string; action: string; details: Record<string, unknown>; created_at: string }[];
  reps: { id: string; name: string; status: string; work_state: string | null; work_locality: string | null; milestone_bonus: { available: boolean; reason: string }; randomized_activity_bonus: { available: boolean; reason: string } }[];
}

export type DrawingTier = { at: number; cents: number };
export type DrawingEntry = { rep_id: string; name: string; base: number; activity: number; entries: number };
export interface AdminDrawings {
  tiers: DrawingTier[]; entry_cap: number; paying_accounts: number; prize_cents: number; current: DrawingEntry[];
  drawings: { id: string; month: string; status: "drawn" | "no_draw"; reason: string | null; paying_accounts: number; prize_cents: number; total_entries: number;
    entries: DrawingEntry[]; seed: string | null; ticket: number | null; winner_name: string | null; snapshot_hash: string | null; hash_ok: boolean; commission_status: string | null }[];
}
export interface MyDrawing {
  status: { available: boolean; reason: string; message: string | null }; tiers: DrawingTier[]; entry_cap: number; prize_cents: number; my_entries: number; my_activity: number;
  history: { month: string; status: string; reason: string | null; prize_cents: number; total_entries: number; won: boolean; my_entries: number }[];
}
export const DRAW_SKIP: Record<string, string> = {
  below_threshold: "Not enough paying accounts yet", program_off: "Program was off", no_eligible_reps: "No eligible representatives",
};

/** Share of revenue as a percentage string, or a dash. */
export const ratio = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

/** One payroll CSV row per ledger line, standard commissions and one-time bonuses labeled separately. */
export function payrollCsv(lines: { rep_name: string; rep_email: string; work_state: string | null; category: string; kind: string; year_no: number; reason: string | null; amount_cents: number; status: string; policy_version: number | null; statement_status: string; paid_on: string | null; method: string | null; reference: string | null; line_id: string }[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s; // spreadsheet formula injection guard
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["Rep", "Email", "Work state", "Category", "Type", "Year", "Reason", "Amount (USD)", "Line status", "Policy version", "Statement status", "Paid on", "Method", "Reference", "Line id"];
  const rows = lines.map((l) => [l.rep_name, l.rep_email, l.work_state, l.category === "one_time_bonus" ? "One-time bonus" : "Standard commission", l.kind, l.year_no, l.reason, (l.amount_cents / 100).toFixed(2), l.status, l.policy_version, l.statement_status, l.paid_on, l.method, l.reference, l.line_id]);
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
