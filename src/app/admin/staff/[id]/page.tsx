import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PageHead, Panel, Chip, Empty, type Tone } from "@/components/admin/cc";
import { requireStaffCap } from "@/lib/staff/server";
import { CLASSIFICATION, STAFF_STATUS } from "@/lib/payouts/labels";
import { STAFF_ERR, STAFF_FLASH, parseStaffFlash } from "@/lib/staff/flash";
import { StaffForm, type StaffRow } from "@/components/staff/staff-form";
import { site } from "@/lib/site";
import { inviteStaff, setBankingAccess, setStaffStatus, updateStaff, verifyTaxItem } from "../actions";

const inFuture = (iso: string) => Date.parse(iso) > Date.now();

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff member" };

const STEP_TONE: Record<string, Tone> = { done: "green", payroll: "blue", todo: "amber", blocked: "red" };
const OK: Record<string, string> = { created: "Added.", saved: "Saved.", invited: "New onboarding link created.", active: "Reactivated.", suspended: "Suspended. Sales Hub access and new payouts are paused.", terminated: "Terminated. New payouts stopped.", banking_granted: "Read-only banking access granted.", banking_revoked: "Banking access removed.", verified: "Recorded." };
const btn = "cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]";

export default async function StaffMemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, db, owner } = await requireStaffCap("staff.view");
  const [{ data, error }, { data: listData }] = await Promise.all([
    db.rpc("admin_staff_get", { p_caller: user.id, p_id: id }),
    db.rpc("admin_staff_list", { p_caller: user.id }),
  ]);
  if (error || !data) notFound();
  const s = data as StaffRow;
  const people = ((listData ?? []) as StaffRow[]).map((p) => ({ id: p.id, display_name: p.display_name }));
  const flash = parseStaffFlash((await cookies()).get(STAFF_FLASH)?.value);
  const link = flash && flash.id === s.id ? `${site.url}/staff/invite/${flash.token}` : null;
  const t = s.tax ?? {};
  const w2 = s.classification === "employee_w2";
  return (
    <div className="space-y-6">
      <PageHead kicker="Team & Staff" title={s.preferred_name ?? s.display_name} intro={`${s.email} · ${s.job_title ?? "No title"} · ${CLASSIFICATION[s.classification]}`}
        right={<Chip tone={s.status === "active" ? "green" : s.status === "suspended" ? "red" : "amber"}>{STAFF_STATUS[s.status]}</Chip>} />
      {sp.ok && <p role="status" className="cc-mono rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-xs text-[var(--cc-green)]">{OK[sp.ok] ?? "Done."}</p>}
      {sp.err && <p role="alert" className="cc-mono rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-xs text-[var(--cc-red)]">{STAFF_ERR[sp.err] ?? STAFF_ERR.invalid}</p>}
      {link && (
        <Panel title="Onboarding link (shown once)" kicker="Copy and send it yourself">
          <p className="break-all rounded-md border border-[var(--cc-line)] bg-black/40 p-3 font-mono text-xs text-white" data-testid="staff-invite-link">{link}</p>
          <p className="mt-2 text-xs text-ink-soft">Works for 7 days, only for {s.email}. Creating a new link cancels this one.</p>
        </Panel>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Panel title="Onboarding progress">
            <ol className="grid gap-2 sm:grid-cols-2">
              {(s.onboarding?.steps ?? []).map((st, i) => (
                <li key={st.key} className="flex items-center justify-between rounded-md border border-[var(--cc-line)] px-3 py-2 text-sm text-white">
                  <span>{i + 1}. {st.label}</span>
                  <Chip tone={STEP_TONE[st.state] ?? "muted"}>{st.state === "payroll" ? "via payroll" : st.state === "blocked" ? "waiting on owner" : st.state}</Chip>
                </li>
              ))}
            </ol>
            {s.classification === "pending_review" && <p className="mt-3 text-xs text-[var(--cc-amber)]">Classification isn&apos;t reviewed yet, so agreements and payouts are on hold. Set it below.</p>}
            {owner && s.status !== "terminated" && s.status !== "suspended" && (
              <form action={inviteStaff} className="mt-3"><input type="hidden" name="id" value={s.id} />
                <button className={btn}>{s.invite ? "Create a new onboarding link" : "Create onboarding link"}</button>
                {s.invite && <span className="ml-3 text-xs text-ink-soft">Last link: {s.invite.accepted_at ? `used ${new Date(s.invite.accepted_at).toLocaleDateString()}` : s.invite.revoked_at ? "replaced" : `expires ${new Date(s.invite.expires_at).toLocaleDateString()}`}</span>}
              </form>
            )}
          </Panel>
          {owner ? (
            <Panel title="Professional record"><StaffForm s={s} people={people} action={updateStaff} submit="Save" /></Panel>
          ) : <Panel title="Professional record"><p className="text-sm text-ink-soft">Only the owner can edit staff records.</p></Panel>}
        </div>
        <div className="space-y-6">
          <Panel title="Personal (entered by them)">
            <dl className="space-y-1 text-xs text-ink-soft">
              <div>Legal name: <span className="text-white">{[s.legal_first_name, s.legal_last_name].filter(Boolean).join(" ") || "—"}</span></div>
              <div>Phone: <span className="text-white">{s.phone ?? "—"}</span></div>
              <div>Address: <span className="text-white">{[s.address_line1, s.address_line2, s.city, s.state, s.postal_code].filter(Boolean).join(", ") || "—"}</span></div>
              <div>Emergency: <span className="text-white">{s.emergency_name ? `${s.emergency_name} (${s.emergency_relation ?? "contact"}) ${s.emergency_phone ?? ""}` : "—"}</span></div>
            </dl>
          </Panel>
          <Panel title={w2 ? "Employment forms" : "Tax form"}>
            {w2 ? (
              <ul className="space-y-2 text-xs text-white">
                <li>W-4: {String(t.w4_status ?? "not_started")} {owner && t.w4_status === "completed_in_payroll" && <TaxBtn id={s.id} item="w4" label="Verify" />}</li>
                <li>State W-4MN: {String(t.state_w4_status ?? "not_started")} {owner && t.state_w4_status === "completed_in_payroll" && <TaxBtn id={s.id} item="state_w4" label="Verify" />}</li>
                <li>I-9 Section 1: {String(t.i9_section1_status ?? "not_started")} · Section 2 (employer): {t.i9_section2_verified_at ? "verified" : "not yet"} {owner && t.i9_section1_status === "completed" && <TaxBtn id={s.id} item="i9_section2" label="I examined the documents" />}</li>
                <li>MN wage notice: {t.wage_notice_ack_at ? "acknowledged" : "not yet"}</li>
                <li>MN new-hire report: {t.new_hire_reported_at ? String(t.new_hire_reported_at) : "not recorded"} {owner && !t.new_hire_reported_at && <TaxBtn id={s.id} item="new_hire_reported" label="Mark reported today" />}</li>
                <li className="text-ink-soft">Payroll Integration Required: wages aren&apos;t paid from Built2Bid until a payroll provider is connected.</li>
              </ul>
            ) : (
              <div className="space-y-2 text-xs text-white">
                <p>W-9: {String(t.w9_status ?? "not_started")}{t.tin_last4 ? ` · ${String(t.tin_type).toUpperCase()} ending ${t.tin_last4}` : ""}</p>
                {t.w9_legal_name && <p className="text-ink-soft">{String(t.w9_legal_name)}{t.w9_business_name ? ` / ${t.w9_business_name}` : ""} · {String(t.w9_tax_class ?? "")}</p>}
                {owner && t.w9_status === "submitted" && <div className="flex gap-2"><TaxBtn id={s.id} item="w9" label="Mark verified" /><TaxBtn id={s.id} item="w9_correction" label="Needs correction" /></div>}
                <p className="text-ink-soft">The full TIN is encrypted and never shown here.</p>
              </div>
            )}
          </Panel>
          <Panel title="Payout bank">
            {w2 ? <p className="text-xs text-ink-soft">Paid through payroll, never contractor payouts.</p> : s.destinations.length === 0 ? <Empty>Not connected yet</Empty> : (
              <ul className="space-y-2 text-xs text-white">{s.destinations.map((d) => (
                <li key={d.id}>{d.institution_name ?? "Bank"} {d.account_type} ••{d.last4 ?? "????"} · <Chip tone={d.status === "verified" ? "green" : "amber"}>{d.status}</Chip> {d.mode === "test" && <Chip tone="muted">test</Chip>}
                  {d.eligible_from && inFuture(d.eligible_from) && <div className="text-[var(--cc-amber)]">New account: payouts held until {new Date(d.eligible_from).toLocaleString()}</div>}</li>))}</ul>
            )}
            <p className="mt-2 text-[11px] text-ink-soft">Bank numbers stay with the payment provider; Built2Bid keeps the bank name and last 4 only.</p>
          </Panel>
          <Panel title="Agreements">
            {s.agreements.length === 0 ? <Empty>None accepted yet</Empty> : <ul className="space-y-1 text-xs text-white">{s.agreements.map((a) => <li key={a.kind}>{a.title} v{a.version} · {new Date(a.accepted_at).toLocaleDateString()} · signed “{a.typed_name}”</li>)}</ul>}
            {s.fee_ack_optional && <p className="mt-2 text-[11px] text-ink-soft">On the team before V8.1: the fee disclosure is optional; until accepted, Built2Bid pays their transfer fees.</p>}
          </Panel>
          {owner && (
            <Panel title="Access">
              <p className="text-xs text-ink-soft">Banking & Cash Flow (read-only): <span className="text-white">{s.banking_read ? "granted" : "not granted"}</span></p>
              <form action={setBankingAccess} className="mt-2"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="grant" value={s.banking_read ? "0" : "1"} />
                <button className={btn}>{s.banking_read ? "Remove banking access" : "Grant read-only banking"}</button></form>
              <form action={setStaffStatus} className="mt-4 space-y-2"><input type="hidden" name="id" value={s.id} />
                <input name="reason" maxLength={500} placeholder="Reason (kept in the audit log)" className="field field-sm w-full" />
                <div className="flex flex-wrap gap-2">
                  {s.status !== "active" && s.status !== "terminated" && s.status !== "invited" && <button name="status" value="active" className={btn}>Reactivate</button>}
                  {s.status !== "suspended" && s.status !== "terminated" && <button name="status" value="suspended" className={btn}>Suspend</button>}
                  {s.status !== "terminated" && <button name="status" value="terminated" className="cc-mono rounded-md border border-[var(--cc-red)]/60 px-3 py-1.5 text-xs text-[var(--cc-red)]">Terminate</button>}
                </div>
              </form>
              {s.sales_rep && <p className="mt-3 text-[11px] text-ink-soft">Suspending pauses their Sales Hub login. Removing them from the Sales Hub is done in <Link className="underline" href={`/sales/admin/reps/${s.sales_rep.id}/manage`}>Sales Hub → rep</Link>, because it can affect commission eligibility.</p>}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function TaxBtn({ id, item, label }: { id: string; item: string; label: string }) {
  return <form action={verifyTaxItem} className="inline"><input type="hidden" name="id" value={id} /><input type="hidden" name="item" value={item} /><button className="cc-mono ml-1 rounded border border-[var(--cc-line)] px-1.5 py-0.5 text-[11px] text-[var(--cc-blue)]">{label}</button></form>;
}
