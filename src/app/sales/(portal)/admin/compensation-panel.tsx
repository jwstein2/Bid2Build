import { Badge, Card, Notice } from "@/components/ui/misc";
import { dateLabel, monthLabel, usd } from "@/lib/sales/format";
import { ratio, type AdminCompensation, type AdminPrograms } from "@/lib/sales/compensation";
import { emergencyProgram, resolveDispute, revokeJurisdiction, saveJurisdiction, saveMilestoneModel, saveWorkLocation, setProgram } from "./compensation-actions";

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold";
const th = "p-3 font-medium";
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const AWARD_STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "brand" | "accent" }> = {
  locked: { label: "In hold (V2)", tone: "neutral" }, ready: { label: "Earned", tone: "brand" }, approved: { label: "Approved", tone: "accent" },
  void: { label: "Voided", tone: "danger" }, ineligible: { label: "Not eligible", tone: "neutral" }, paid: { label: "Paid", tone: "ok" },
};
const REASON: Record<string, string> = {
  always: "Always on", enabled: "On", approved: "Approved for this location", disabled: "Off", emergency_disabled: "Emergency stop",
  eligibility_ended: "Ended for the future", not_approved: "No approval for this location", approval_expired: "Approval expired",
  work_location_missing: "Work location not set", jurisdiction_prohibited: "Prohibited here", jurisdiction_not_approved: "Not approved here",
};

function Rules({ model, qualification, owner }: { model: string; qualification: string; owner: boolean }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold">Milestone rules in force</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {model === "v3_active_mrr" ? "Compensation Model V3: one-time bonuses at 10 ($25), 25 ($75), then every 25 qualifying customers at 3% (50-75), 4% (100-225) and 5% (250+) of qualifying active attributed MRR, snapshotted when earned." : "V2: gift boxes every 50 accounts paying a share of still-active revenue since the last box, with a minimum."}{" "}
        {qualification === "second_cycle" ? "Customers count at their second billing cycle (annual: one month after payment)." : "Customers count at their first payment."}
      </p>
      <Notice tone="warn" className="mt-3" title="Awaiting owner and counsel confirmation">The second-cycle qualification checkpoint changes when a milestone is earned compared with the draft commission plan (first payment + 30-day hold). Confirm with counsel; switching back below is prospective only.</Notice>
      {owner && (
        <form action={saveMilestoneModel} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <label className="text-sm">Model<select name="model" defaultValue={model} className={input}><option value="v3_active_mrr">V3: active MRR</option><option value="v2_window">V2: revenue window</option></select></label>
          <label className="text-sm">Customer counts at<select name="qualification" defaultValue={qualification} className={input}><option value="second_cycle">Second billing cycle</option><option value="first_payment">First payment</option></select></label>
          <label className="text-sm">Reason (policy history)<input name="note" required minLength={3} maxLength={500} className={input} placeholder="e.g. Counsel approved second-cycle rule" /></label>
          <button type="submit" className={btn}>Save</button>
        </form>
      )}
    </Card>
  );
}

function Programs({ p, owner, canStop, canLocate }: { p: AdminPrograms; owner: boolean; canStop: boolean; canLocate: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section aria-labelledby="programs-h" className="space-y-3">
      <h2 id="programs-h" className="text-lg font-bold">Incentive programs and jurisdictions</h2>
      <p className="text-sm text-ink-soft">Each program is separate. Availability uses each representative&apos;s actual work state and city, never headquarters. Turning a program off only stops future eligibility; earned compensation stands.</p>
      <div className="grid gap-3 lg:grid-cols-3">
        {p.programs.map((g) => {
          const on = g.kind === "earned_commission" || (g.enabled && !g.emergency_disabled_at);
          return (
            <Card key={g.key} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold">{g.name}</h3>
                <Badge tone={g.emergency_disabled_at ? "danger" : on ? "ok" : "neutral"}>{g.emergency_disabled_at ? "Emergency stop" : on ? "On" : "Off"}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">{g.description}</p>
              {g.requires_jurisdiction_approval && <p className="mt-1 text-xs font-semibold text-warn">Needs a documented legal approval for each state before it can run.</p>}
              {g.emergency_reason && <p className="mt-1 text-xs text-danger">Stopped: {g.emergency_reason}</p>}
              {g.kind !== "earned_commission" && (
                <div className="mt-auto space-y-2 pt-3">
                  {owner && (
                    <form action={setProgram} className="flex flex-wrap gap-2">
                      <input type="hidden" name="key" value={g.key} /><input type="hidden" name="enabled" value={g.enabled ? "off" : "on"} />
                      <input name="note" required minLength={3} maxLength={500} placeholder="Reason" aria-label={`Reason to turn ${g.name} ${g.enabled ? "off" : "on"}`} className={`${input} flex-1`} />
                      <button type="submit" className={btnLight}>{g.enabled ? "Turn off" : "Turn on"}</button>
                    </form>
                  )}
                  {canStop && !g.emergency_disabled_at && (
                    <form action={emergencyProgram} className="flex flex-wrap gap-2">
                      <input type="hidden" name="key" value={g.key} /><input type="hidden" name="stop" value="on" />
                      <input name="reason" required minLength={3} maxLength={300} placeholder="Why stop now?" aria-label={`Reason for emergency stop of ${g.name}`} className={`${input} flex-1`} />
                      <button type="submit" className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-white">Emergency stop</button>
                    </form>
                  )}
                  {owner && g.emergency_disabled_at && (
                    <form action={emergencyProgram} className="flex flex-wrap gap-2">
                      <input type="hidden" name="key" value={g.key} /><input type="hidden" name="stop" value="off" />
                      <input name="reason" required minLength={3} maxLength={300} placeholder="Reason to clear" aria-label="Reason to clear emergency stop" className={`${input} flex-1`} />
                      <button type="submit" className={btnLight}>Clear stop</button>
                    </form>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="p-3 text-left font-bold">Jurisdiction decisions</caption>
          <thead className="border-b border-line text-left text-muted"><tr><th className={th}>Program</th><th className={th}>Where</th><th className={th}>Decision</th><th className={th}>Legal approval</th><th className={th}>Effective</th><th className={th}>State</th><th className={th}></th></tr></thead>
          <tbody>
            {p.jurisdictions.map((j) => (
              <tr key={j.id} className="border-b border-line align-top last:border-0">
                <td className="p-3">{p.programs.find((g) => g.key === j.program_key)?.name ?? j.program_key}</td>
                <td className="p-3">{j.state}{j.locality ? `, ${j.locality}` : " (statewide)"}</td>
                <td className="p-3">{j.status === "approved" ? "Approved" : j.status === "prohibited" ? "Prohibited" : "Not approved"}</td>
                <td className="p-3">{j.legal_reference ?? "—"}{j.reviewed_by ? <p className="text-xs text-muted">{j.reviewed_by}</p> : null}</td>
                <td className="p-3">{dateLabel(j.effective_from)} – {j.expires_on ? dateLabel(j.expires_on) : "no end"}</td>
                <td className="p-3">{j.revoked_at ? <Badge>Revoked</Badge> : j.current ? <Badge tone="ok">Current</Badge> : j.expires_on && j.expires_on <= today ? <Badge tone="warn">Expired</Badge> : <Badge>Not yet</Badge>}</td>
                <td className="p-3">{owner && !j.revoked_at && (
                  <form action={revokeJurisdiction} className="flex gap-2"><input type="hidden" name="id" value={j.id} /><input name="reason" required minLength={3} maxLength={300} placeholder="Reason" aria-label="Reason to revoke" className={`${input} w-32`} /><button type="submit" className={btnLight}>Revoke</button></form>
                )}</td>
              </tr>
            ))}
            {p.jurisdictions.length === 0 && <tr><td colSpan={7} className="p-3 text-ink-soft">No jurisdiction decisions recorded. The randomized activity bonus stays off everywhere until one is approved.</td></tr>}
          </tbody>
        </table>
      </Card>

      {owner && (
        <Card className="p-5">
          <h3 className="font-bold">Record a jurisdiction decision</h3>
          <p className="mt-1 text-xs text-muted">Decisions are never edited. To change one, record a new decision and revoke the old one. Approvals stop working on their expiry date automatically.</p>
          <form action={saveJurisdiction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">Program<select name="key" className={input}><option value="randomized_activity_bonus">Randomized activity bonus</option><option value="milestone_bonus">Customer milestone bonuses</option></select></label>
            <label className="text-sm">State<select name="state" required className={input}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="text-sm">City or county (blank = statewide)<input name="locality" maxLength={120} className={input} /></label>
            <label className="text-sm">Decision<select name="status" className={input}><option value="approved">Approved</option><option value="not_approved">Not approved</option><option value="prohibited">Prohibited</option></select></label>
            <label className="text-sm">Legal memo / opinion reference<input name="legal_reference" maxLength={300} className={input} /></label>
            <label className="text-sm">Reviewing attorney<input name="reviewed_by" maxLength={120} className={input} /></label>
            <label className="text-sm">Effective from<input name="effective_from" type="date" required defaultValue={today} className={input} /></label>
            <label className="text-sm">Expires on<input name="expires_on" type="date" className={input} /></label>
            <label className="text-sm sm:col-span-2 lg:col-span-3">Notes<input name="notes" maxLength={600} className={input} /></label>
            <div className="flex items-end"><button type="submit" className={btn}>Record decision</button></div>
          </form>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="p-3 text-left font-bold">Representative work locations</caption>
          <thead className="border-b border-line text-left text-muted"><tr><th className={th}>Representative</th><th className={th}>Works in</th><th className={th}>Milestone bonuses</th><th className={th}>Activity bonus</th></tr></thead>
          <tbody>
            {p.reps.map((r) => (
              <tr key={r.id} className="border-b border-line align-top last:border-0">
                <td className="p-3 font-semibold">{r.name}</td>
                <td className="p-3">
                  {canLocate ? (
                    <form action={saveWorkLocation} className="flex flex-wrap gap-2">
                      <input type="hidden" name="rep" value={r.id} />
                      <select name="state" defaultValue={r.work_state ?? ""} aria-label={`${r.name} work state`} className={`${input} w-20`}><option value="">—</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select>
                      <input name="locality" defaultValue={r.work_locality ?? ""} maxLength={120} placeholder="City" aria-label={`${r.name} work city`} className={`${input} w-32`} />
                      <button type="submit" className={btnLight}>Save</button>
                    </form>
                  ) : `${r.work_state ?? "—"}${r.work_locality ? `, ${r.work_locality}` : ""}`}
                </td>
                <td className="p-3">{r.milestone_bonus.available ? <Badge tone="ok">Eligible</Badge> : <Badge>{REASON[r.milestone_bonus.reason] ?? r.milestone_bonus.reason}</Badge>}</td>
                <td className="p-3">{r.randomized_activity_bonus.available ? <Badge tone="ok">Eligible</Badge> : <Badge>{REASON[r.randomized_activity_bonus.reason] ?? r.randomized_activity_bonus.reason}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <details className="rounded-xl border border-line bg-surface p-4">
        <summary className="cursor-pointer font-semibold">Program history ({p.events.length})</summary>
        <ul className="mt-3 divide-y divide-line text-sm">
          {p.events.map((e) => <li key={e.id} className="py-2"><span className="font-semibold">{e.action.replace(/_/g, " ")}</span> · {e.program_key.replace(/_/g, " ")} · {dateLabel(e.created_at)}<p className="break-all text-xs text-muted">{JSON.stringify(e.details)}</p></li>)}
          {p.events.length === 0 && <li className="py-2 text-ink-soft">No changes yet.</li>}
        </ul>
      </details>
    </section>
  );
}

/** Owner view of sales compensation: cost vs revenue, per-rep obligations, award calculations, disputes, payroll. */
export function CompensationPanel({ c, p, owner, canStop, canLocate, canAdjust, model, qualification }: {
  c: AdminCompensation | null; p: AdminPrograms | null; owner: boolean; canStop: boolean; canLocate: boolean; canAdjust: boolean; model: string; qualification: string;
}) {
  const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  return (
    <div className="space-y-6">
      <Rules model={model} qualification={qualification} owner={owner} />
      {!c && <Notice tone="warn" title="Owner only">Compensation totals, award calculations and payroll are visible to the platform owner.</Notice>}
      {c && (
        <>
          <Card className="flex flex-wrap items-end justify-between gap-3 p-5">
            <div>
              <h2 className="text-lg font-bold">Payroll export</h2>
              <p className="mt-1 text-sm text-ink-soft">Every statement line for a month, labeled standard commission or one-time bonus, with the payout recorded against it.</p>
            </div>
            <form action="/sales/admin/payroll/export" method="get" className="flex flex-wrap gap-2">
              <label className="text-sm">Statement month<input name="month" type="month" required defaultValue={lastMonth} className={input} /></label>
              <button type="submit" className={`${btnLight} self-end`}>Download CSV</button>
            </form>
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <caption className="p-3 text-left font-bold">Compensation by month</caption>
              <thead className="border-b border-line text-left text-muted"><tr><th className={th}>Month</th><th className={th}>Attributed revenue</th><th className={th}>Standard commissions</th><th className={th}>One-time bonuses</th><th className={th}>Paid out</th><th className={th}>Commission / revenue</th><th className={th}>Bonus / revenue</th></tr></thead>
              <tbody>
                {c.months.map((m) => (
                  <tr key={m.month} className="border-b border-line last:border-0 tabular-nums">
                    <td className="p-3">{monthLabel(m.month)}</td><td className="p-3">{usd(m.revenue_cents)}</td><td className="p-3">{usd(m.commission_cents)}</td>
                    <td className="p-3">{usd(m.bonus_cents)}</td><td className="p-3">{usd(m.paid_cents)}</td><td className="p-3">{ratio(m.commission_cents, m.revenue_cents)}</td><td className="p-3">{ratio(m.bonus_cents, m.revenue_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[72rem] text-sm">
              <caption className="p-3 text-left font-bold">Representatives</caption>
              <thead className="border-b border-line text-left text-muted"><tr><th className={th}>Representative</th><th className={th}>Paying / attributed</th><th className={th}>Retention</th><th className={th}>Qualifying</th><th className={th}>Active MRR</th><th className={th}>Commissions earned</th><th className={th}>Bonuses earned</th><th className={th}>Owed now</th><th className={th}>Paid out</th><th className={th}>Comm. / rev.</th><th className={th}>Bonus / rev.</th></tr></thead>
              <tbody>
                {c.reps.map((r) => (
                  <tr key={r.rep_id} className="border-b border-line align-top last:border-0 tabular-nums">
                    <td className="p-3"><p className="font-semibold">{r.rep_name}</p><p className="text-xs text-muted">{r.status}{r.work_state ? ` · ${r.work_state}` : ""}{r.next ? ` · next ${r.next.at} (${r.remaining} to go)` : ""}</p></td>
                    <td className="p-3">{r.active_paying} / {r.attributed}</td>
                    <td className="p-3">{ratio(r.active_paying, r.ever_paid)}</td>
                    <td className="p-3">{r.qualifying}</td>
                    <td className="p-3">{usd(r.qualifying_mrr_cents)}</td>
                    <td className="p-3">{usd(r.commission_earned_cents)}</td>
                    <td className="p-3">{usd(r.bonus_earned_cents)}</td>
                    <td className="p-3">{usd(r.obligation_cents)}</td>
                    <td className="p-3">{usd(r.paid_out_cents)}</td>
                    <td className="p-3">{ratio(r.commission_earned_cents, r.revenue_cents)}</td>
                    <td className="p-3">{ratio(r.bonus_earned_cents, r.revenue_cents)}</td>
                  </tr>
                ))}
                {c.reps.length === 0 && <tr><td colSpan={11} className="p-3 text-ink-soft">No selling representatives yet.</td></tr>}
              </tbody>
            </table>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-bold">Milestone awards and their calculations</h2>
            <p className="mt-1 text-sm text-ink-soft">Each award stores the exact inputs it was calculated from and a fingerprint (SHA-256). Nothing here can change an earned award; approve or void it on Commission approvals.</p>
            <ul className="mt-3 divide-y divide-line text-sm">
              {c.awards.map((a) => {
                const st = a.commission_status === "paid" ? AWARD_STATUS.paid : AWARD_STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };
                return (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{a.rep_name} · {a.milestone} customers · {a.flat_cents != null ? `flat ${usd(a.flat_cents)}` : `${a.pct}% of ${a.rule_set === "v3_active_mrr" ? `${usd(a.mrr_cents)} MRR` : `${usd(a.revenue_cents)} revenue`}`} = {a.amount_cents == null ? "—" : usd(a.amount_cents)}</p>
                      <div className="flex gap-2"><Badge tone={st.tone}>{st.label}</Badge>{a.hash_ok ? <Badge tone="ok">Record verified</Badge> : <Badge tone="danger">Record changed</Badge>}</div>
                    </div>
                    <p className="text-xs text-muted">Reached {dateLabel(a.reached_at)} · policy v{a.policy_version ?? "?"} · {a.rule_set === "v3_active_mrr" ? "V3" : "V2"}{a.void_reason ? ` · ${a.void_reason}` : ""}</p>
                    {a.snapshot && (
                      <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-brand">Show calculation</summary>
                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper p-3 text-xs">{JSON.stringify({ ...a.snapshot, mrr_customers: Array.isArray(a.snapshot.mrr_customers) ? `${(a.snapshot.mrr_customers as unknown[]).length} customers (ids kept in the record)` : undefined }, null, 2)}</pre>
                        <p className="mt-1 break-all text-xs text-muted">Fingerprint {a.snapshot_hash}</p>
                      </details>
                    )}
                  </li>
                );
              })}
              {c.awards.length === 0 && <li className="py-2 text-ink-soft">No milestone awards yet.</li>}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-bold">Disputes and adjustments</h2>
            <ul className="mt-3 divide-y divide-line text-sm">
              {c.disputes.map((d) => (
                <li key={d.id} className="py-3">
                  <p className="font-semibold">{d.rep_name} · {d.milestone}-customer bonus · <Badge tone={d.status === "open" ? "warn" : d.status === "upheld" ? "ok" : "neutral"}>{d.status}</Badge></p>
                  <p className="text-ink-soft">&ldquo;{d.note}&rdquo; · {dateLabel(d.created_at)}</p>
                  {d.resolution && <p className="text-xs text-muted">Decision: {d.resolution}{d.adjustment_cents ? ` · adjustment ${usd(d.adjustment_cents)}` : ""}</p>}
                  {d.status === "open" && canAdjust && (
                    <form action={resolveDispute} className="mt-2 grid gap-2 sm:grid-cols-[auto_2fr_1fr_auto]">
                      <input type="hidden" name="id" value={d.id} />
                      <select name="outcome" aria-label="Outcome" className={input}><option value="denied">Deny</option><option value="upheld">Uphold</option></select>
                      <input name="resolution" required minLength={3} maxLength={1000} placeholder="Written decision" aria-label="Written decision" className={input} />
                      <input name="adjustment" inputMode="decimal" placeholder="Extra $ (if upheld)" aria-label="Adjustment in dollars" className={input} />
                      <button type="submit" className={btn}>Decide</button>
                    </form>
                  )}
                </li>
              ))}
              {c.disputes.length === 0 && <li className="py-2 text-ink-soft">No disputes.</li>}
            </ul>
            {c.adjustments.length > 0 && (
              <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Recent adjustments ({c.adjustments.length})</summary>
                <ul className="mt-2 space-y-1 text-xs">{c.adjustments.map((a, i) => <li key={i}><span className="font-semibold">{a.action.replace("sales.", "").replace(/_/g, " ")}</span> · {dateLabel(a.at)} <span className="break-all text-muted">{JSON.stringify(a.details)}</span></li>)}</ul>
              </details>
            )}
          </Card>
        </>
      )}
      {p && <Programs p={p} owner={owner} canStop={canStop} canLocate={canLocate} />}
    </div>
  );
}
