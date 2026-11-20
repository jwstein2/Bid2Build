import { CLASSIFICATION, COMP, ROLE } from "@/lib/payouts/labels";

export interface StaffRow {
  id: string; email: string; display_name: string; preferred_name: string | null; legal_first_name: string | null; legal_last_name: string | null;
  job_title: string | null; department: string | null; start_date: string | null; end_date: string | null; manager_id: string | null; manager_name: string | null;
  status: string; classification: string; classification_reviewed_at: string | null; classification_note: string | null; comp_types: string[];
  pay_rate_cents: number | null; pay_unit: string | null; pay_frequency: string | null; work_state: string | null; payment_method: string; roles: string[];
  banking_read: boolean; phone: string | null; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; postal_code: string | null; country: string;
  emergency_name: string | null; emergency_phone: string | null; emergency_relation: string | null; status_reason: string | null; fee_ack_optional: boolean;
  sales_rep: { id: string; role: string; status: string; code: string } | null;
  onboarding: { steps: { key: string; label: string; state: string }[]; complete: boolean } | null;
  tax: Record<string, string | boolean | null> | null;
  destinations: { id: string; mode: string; provider: string; institution_name: string | null; account_type: string; last4: string | null; status: string; verified_at: string | null; eligible_from: string | null; created_at: string }[];
  agreements: { kind: string; version: number; title: string; accepted_at: string; typed_name: string }[];
  invite: { expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string } | null;
}

const L = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <label className={`text-xs ${wide ? "sm:col-span-2" : ""}`}><span className="cc-kicker mb-1 block">{label}</span>{children}</label>
);

/** The owner's professional record for a staff member. Classification is set explicitly and reviewed; nothing is assumed. */
export function StaffForm({ s, people, action, submit }: { s?: StaffRow; people: { id: string; display_name: string }[]; action: (fd: FormData) => Promise<void>; submit: string }) {
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {s && <input type="hidden" name="id" value={s.id} />}
      {!s && <L label="Email (they sign in with this)"><input name="email" type="email" required maxLength={320} className="field field-sm w-full" /></L>}
      <L label="Name"><input name="display_name" required maxLength={120} defaultValue={s?.display_name ?? ""} className="field field-sm w-full" /></L>
      <L label="Job title"><input name="job_title" maxLength={120} defaultValue={s?.job_title ?? ""} className="field field-sm w-full" /></L>
      <L label="Department"><input name="department" maxLength={80} defaultValue={s?.department ?? ""} className="field field-sm w-full" placeholder="Sales, Finance, Operations…" /></L>
      <L label="Start date"><input name="start_date" type="date" defaultValue={s?.start_date ?? ""} className="field field-sm w-full" /></L>
      {s && <L label="End date"><input name="end_date" type="date" defaultValue={s?.end_date ?? ""} className="field field-sm w-full" /></L>}
      <L label="Manager / supervisor">
        <select name="manager_id" defaultValue={s?.manager_id ?? ""} className="field field-sm w-full">
          <option value="">None</option>
          {people.filter((p) => p.id !== s?.id).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
      </L>
      <L label="Work state (for wage and fee rules)"><input name="work_state" maxLength={2} defaultValue={s?.work_state ?? ""} className="field field-sm w-24 uppercase" placeholder="MN" /></L>
      <fieldset className="rounded-lg border border-[var(--cc-line)] p-3 sm:col-span-2">
        <legend className="cc-kicker px-1">Classification</legend>
        <select name="classification" defaultValue={s?.classification ?? "pending_review"} className="field field-sm w-full sm:w-96">
          {Object.entries(CLASSIFICATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <p className="mt-2 text-xs text-ink-soft">Worker classification follows the law (who controls the work, how they&apos;re paid, whether they run their own business), not this label. Choose it after review; &quot;Pending&quot; is never paid through contractor payouts. W-2 pay goes through payroll.</p>
        <textarea name="classification_note" maxLength={1000} defaultValue={s?.classification_note ?? ""} rows={2} placeholder="Review note (who reviewed, basis)" className="field field-sm mt-2 w-full" />
        {s && <label className="mt-2 flex items-center gap-2 text-xs text-white"><input type="checkbox" name="mark_reviewed" /> I reviewed this classification today</label>}
      </fieldset>
      <fieldset className="rounded-lg border border-[var(--cc-line)] p-3 sm:col-span-2">
        <legend className="cc-kicker px-1">Compensation</legend>
        <div className="flex flex-wrap gap-3">
          {Object.entries(COMP).map(([k, l]) => <label key={k} className="flex items-center gap-1.5 text-xs text-white"><input type="checkbox" name="comp_types" value={k} defaultChecked={s?.comp_types.includes(k)} />{l}</label>)}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <L label="Rate (USD)"><input name="pay_rate" inputMode="decimal" defaultValue={s?.pay_rate_cents != null ? (s.pay_rate_cents / 100).toFixed(2) : ""} className="field field-sm w-full" /></L>
          <L label="Per"><select name="pay_unit" defaultValue={s?.pay_unit ?? ""} className="field field-sm w-full"><option value="">—</option><option value="hour">hour</option><option value="month">month</option><option value="year">year</option><option value="project">project</option></select></L>
          <L label="Pay frequency"><select name="pay_frequency" defaultValue={s?.pay_frequency ?? ""} className="field field-sm w-full"><option value="">—</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="semimonthly">Twice a month</option><option value="monthly">Monthly</option><option value="per_statement">Per approved statement</option></select></L>
        </div>
        <p className="mt-2 text-xs text-ink-soft">Commission rates, durations and holds come only from the Sales Hub policy. Nothing here changes them.</p>
        <L label="How they're paid"><select name="payment_method" defaultValue={s?.payment_method ?? "ach"} className="field field-sm mt-1 w-full sm:w-80"><option value="ach">Direct deposit (contractor ACH)</option><option value="check">Paper check (manual)</option><option value="payroll">Payroll provider (W-2)</option></select></L>
      </fieldset>
      <fieldset className="rounded-lg border border-[var(--cc-line)] p-3 sm:col-span-2">
        <legend className="cc-kicker px-1">Internal roles</legend>
        <div className="flex flex-wrap gap-3">
          {Object.entries(ROLE).map(([k, l]) => <label key={k} className="flex items-center gap-1.5 text-xs text-white"><input type="checkbox" name="roles" value={k} defaultChecked={s?.roles.includes(k)} />{l}</label>)}
        </div>
        <p className="mt-2 text-xs text-ink-soft">Finance and external accountants get read-only payouts, reports and reconciliation. Banking visibility is a separate grant. No role but the owner can send money or change payout rules. Sales selling and Sales Admin powers stay in the Sales Hub.</p>
      </fieldset>
      {!s && <label className="flex items-center gap-2 text-xs text-white sm:col-span-2"><input type="checkbox" name="invite" defaultChecked /> Create a secure onboarding link now (expires in 7 days)</label>}
      <div className="sm:col-span-2"><button className="cc-mono rounded-md bg-[var(--cc-green)] px-4 py-2 text-xs font-bold text-black hover:opacity-90">{submit}</button></div>
    </form>
  );
}
