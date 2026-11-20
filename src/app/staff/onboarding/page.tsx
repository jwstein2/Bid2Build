import Link from "next/link";
import { redirect } from "next/navigation";
import { loadStaffSelf, type StaffMe } from "@/lib/staff/server";
import { CLASSIFICATION, COMP, ROLE, feeCents, money } from "@/lib/payouts/labels";
import { cn } from "@/lib/cn";
import { acceptAgreement, confirmRole, confirmSecurity, employmentItem, finish, paymentMethod, saveProfile, submitW9 } from "./actions";

export const metadata = { title: "Onboarding" };

const ERR: Record<string, string> = {
  required: "Please fill in your legal name, phone and address.", save: "That didn't save. Please try again.", pending: "The owner is still reviewing your role and classification. You'll be able to continue once that's done.",
  agree: "Type your name and tick the box to accept.", w9: "Check the W-9: legal name, tax classification, a 9-digit SSN/EIN/ITIN, signature and the certification box.",
  pii: "Tax forms can't be accepted on this server yet. The owner has been notified; please try again later.", two_step: "Your session isn't using two-step sign-in yet. Turn it on, sign in with your authenticator code, then come back.",
  incomplete: "A few steps still need attention.",
};
const field = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base";
const primary = "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-5 font-semibold text-white active:scale-[0.98]";
const L = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block text-sm font-medium">{label}{children}</label>;

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string; err?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { me } = await loadStaffSelf("/staff/onboarding");
  if (!me || me.status === "suspended" || me.status === "terminated" || !me.onboarding) redirect("/staff");
  const steps = me.onboarding.steps;
  const step = sp.step ?? steps.find((x) => x.state === "todo")?.key ?? "confirm";
  const i = steps.findIndex((x) => x.key === step);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Set up your Built2Bid account</h1>
        <p className="mt-1 text-ink-soft">{me.job_title ?? "Staff"} · {CLASSIFICATION[me.classification]}</p>
      </div>
      <ol className="flex gap-1 overflow-x-auto pb-1 text-xs" aria-label="Onboarding steps">
        {steps.map((x, n) => (
          <li key={x.key}><Link href={`/staff/onboarding?step=${x.key}`} aria-current={x.key === step ? "step" : undefined}
            className={cn("block whitespace-nowrap rounded-full border px-3 py-1.5 font-semibold", x.key === step ? "border-ink bg-ink text-white" : x.state === "done" || x.state === "payroll" ? "border-success/40 bg-success/10 text-success" : "border-line bg-white text-ink-soft")}>
            {x.state === "done" || x.state === "payroll" ? "✓ " : `${n + 1}. `}{x.label}</Link></li>
        ))}
      </ol>
      {sp.err && <p role="alert" className="rounded-lg bg-warn-tint px-4 py-3 text-sm">{ERR[sp.err] ?? ERR.save}</p>}
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">{i + 1}. {steps[i]?.label}</h2>
        <div className="mt-4">{body(step, me)}</div>
      </section>
    </div>
  );
}

function body(step: string, me: StaffMe) {
  const contractor = me.classification === "contractor_1099" || me.classification === "vendor";
  switch (step) {
    case "personal": return (
      <form action={saveProfile} className="grid gap-3 sm:grid-cols-2">
        <L label="Legal first name"><input name="legal_first_name" required defaultValue={me.legal_first_name ?? ""} autoComplete="given-name" className={field} /></L>
        <L label="Legal last name"><input name="legal_last_name" required defaultValue={me.legal_last_name ?? ""} autoComplete="family-name" className={field} /></L>
        <L label="Preferred name (optional)"><input name="preferred_name" defaultValue={me.preferred_name ?? ""} className={field} /></L>
        <L label="Mobile phone"><input name="phone" required type="tel" defaultValue={me.phone ?? ""} autoComplete="tel" className={field} /></L>
        <div className="sm:col-span-2"><L label="Mailing / residential address"><input name="address_line1" required defaultValue={me.address_line1 ?? ""} autoComplete="address-line1" className={field} /></L></div>
        <div className="sm:col-span-2"><L label="Apt, suite (optional)"><input name="address_line2" defaultValue={me.address_line2 ?? ""} autoComplete="address-line2" className={field} /></L></div>
        <L label="City"><input name="city" required defaultValue={me.city ?? ""} autoComplete="address-level2" className={field} /></L>
        <div className="grid grid-cols-2 gap-3"><L label="State"><input name="state" required maxLength={40} defaultValue={me.state ?? ""} autoComplete="address-level1" className={field} /></L><L label="ZIP"><input name="postal_code" required defaultValue={me.postal_code ?? ""} autoComplete="postal-code" className={field} /></L></div>
        <input type="hidden" name="country" value={me.country || "US"} />
        <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3"><legend className="mb-1 text-sm font-semibold">Emergency contact (optional)</legend>
          <L label="Name"><input name="emergency_name" defaultValue={me.emergency_name ?? ""} className={field} /></L>
          <L label="Phone"><input name="emergency_phone" type="tel" defaultValue={me.emergency_phone ?? ""} className={field} /></L>
          <L label="Relationship"><input name="emergency_relation" defaultValue={me.emergency_relation ?? ""} className={field} /></L>
        </fieldset>
        <div className="sm:col-span-2"><button className={primary}>Save and continue</button></div>
      </form>
    );
    case "role": return me.classification === "pending_review" ? <p className="text-ink-soft">The Built2Bid owner is reviewing your role and classification. We&apos;ll continue from here once that&apos;s set; you don&apos;t need to do anything.</p> : (
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">Title</dt><dd>{me.job_title ?? "—"}</dd>
          <dt className="text-muted">Department</dt><dd>{me.department ?? "—"}</dd>
          <dt className="text-muted">Classification</dt><dd>{CLASSIFICATION[me.classification]}</dd>
          <dt className="text-muted">Pay</dt><dd>{me.comp_types.map((c) => COMP[c]).join(", ") || "—"}{me.pay_rate_cents != null ? ` · ${money(me.pay_rate_cents)}${me.pay_unit ? ` per ${me.pay_unit}` : ""}` : ""}</dd>
          <dt className="text-muted">Roles</dt><dd>{me.roles.map((r) => ROLE[r]).join(", ") || "—"}</dd>
        </dl>
        {contractor && <p className="text-ink-soft">As an independent contractor you decide how and when you work, and you&apos;re responsible for your own taxes. Built2Bid doesn&apos;t withhold taxes from your payments.</p>}
        {me.classification === "employee_w2" && <p className="text-ink-soft">As an employee you&apos;re paid through payroll with the required tax withholding. You&apos;re never charged to receive your wages.</p>}
        <p className="text-ink-soft">If anything here looks wrong, tell the owner before continuing.</p>
        <form action={confirmRole}><button className={primary}>This is correct</button></form>
      </div>
    );
    case "agreements": {
      if (me.classification === "pending_review") return <p className="text-ink-soft">Agreements appear once your classification is set.</p>;
      const f = me.fee_policy;
      return (
        <div className="space-y-5">
          {me.required_agreements.map((a) => (
            <article key={a.id} className="rounded-xl border border-line p-4">
              <h3 className="font-bold">{a.title} <span className="text-xs font-normal text-muted">v{a.version}{a.optional ? " · optional for you" : ""}</span></h3>
              <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{a.body}</p>
              {a.kind === "fee_disclosure" && f && (
                <div className="mt-3 rounded-lg bg-paper p-3 text-sm">
                  <p className="font-semibold">Current rates (fee schedule v{f.version})</p>
                  <ul className="mt-1 list-disc pl-5 text-ink-soft">
                    <li>Standard ACH payout: {money(f.standard_fixed_cents)}{f.standard_bps ? ` + ${(f.standard_bps / 100).toFixed(2)}%` : ""} per payout (example: {money(50000)} earned → {money(50000 - feeCents(50000, "standard", f))} deposited)</li>
                    <li>Several commissions in a pay period are combined, so the fee is charged once.</li>
                    <li>No fee to join or keep your account. {f.monthly_account_cents ? `Account fee ${money(f.monthly_account_cents)}/month.` : "No monthly account fee."}</li>
                    <li>{f.instant_enabled ? `Optional instant payout: ${money(f.instant_fixed_cents)} + ${(f.instant_bps / 100).toFixed(2)}% (min ${money(f.instant_min_cents)}).` : "Instant payouts aren't offered right now."}</li>
                    {!f.approved && <li>Until the owner finalizes this schedule, Built2Bid pays these fees.</li>}
                  </ul>
                </div>
              )}
              {a.accepted ? <p className="mt-3 text-sm font-semibold text-success">✓ Accepted</p> : (
                <form action={acceptAgreement} className="mt-3 space-y-2">
                  <input type="hidden" name="id" value={a.id} />
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" className="mt-1" /> I have read and agree to the {a.title}.</label>
                  <input name="typed_name" placeholder="Type your full legal name" className={field} />
                  <button className={primary}>Accept</button>
                </form>
              )}
            </article>
          ))}
          {me.onboarding.missing_agreements.length === 0 && <Link className={primary} href="/staff/onboarding?step=tax">Continue</Link>}
        </div>
      );
    }
    case "tax": {
      if (contractor) {
        if (me.tax?.w9_status === "submitted" || me.tax?.w9_status === "verified") return <div className="space-y-3 text-sm"><p>✓ W-9 on file ({me.tax.tin_type?.toUpperCase()} ending {me.tax.tin_last4}).</p><Link className={primary} href="/staff/onboarding?step=payout">Continue</Link></div>;
        return (
          <form action={submitW9} className="grid gap-3 text-sm">
            <p className="text-ink-soft">IRS Form W-9 information. Your full tax ID is encrypted and only the last 4 digits are shown anywhere in Built2Bid.{me.tax?.w9_status === "needs_correction" ? " The owner asked for a correction." : ""}</p>
            <L label="Name (as shown on your income tax return)"><input name="legal_name" required defaultValue={[me.legal_first_name, me.legal_last_name].filter(Boolean).join(" ")} className={field} /></L>
            <L label="Business name / disregarded entity (optional)"><input name="business_name" className={field} /></L>
            <L label="Federal tax classification"><select name="tax_class" required className={field} defaultValue="individual">
              <option value="individual">Individual / sole proprietor / single-member LLC</option><option value="c_corp">C corporation</option><option value="s_corp">S corporation</option>
              <option value="partnership">Partnership</option><option value="trust_estate">Trust / estate</option><option value="llc_c">LLC taxed as C corp</option><option value="llc_s">LLC taxed as S corp</option><option value="llc_p">LLC taxed as partnership</option><option value="other">Other</option></select></L>
            <L label="Exempt payee code (if any)"><input name="exempt_code" maxLength={4} className={field} /></L>
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <L label="ID type"><select name="tin_type" className={field}><option value="ssn">SSN</option><option value="ein">EIN</option><option value="itin">ITIN</option></select></L>
              <L label="Taxpayer ID number"><input name="tin" required inputMode="numeric" autoComplete="off" pattern="[0-9 -]{9,11}" className={field} /></L>
            </div>
            <label className="flex items-start gap-2"><input type="checkbox" name="certify" className="mt-1" /><span>Under penalties of perjury, I certify that: (1) the number shown is my correct taxpayer identification number; (2) I am not subject to backup withholding because I am exempt, I have not been notified by the IRS that I am subject to backup withholding, or the IRS has notified me that I am no longer subject to it; (3) I am a U.S. citizen or other U.S. person; and (4) any FATCA code entered is correct.</span></label>
            <L label="Signature (type your full name)"><input name="signed_name" required className={field} /></L>
            <button className={primary}>Submit W-9</button>
          </form>
        );
      }
      if (me.classification === "employee_w2") {
        const t = me.tax;
        const Item = ({ item, done, label, help }: { item: string; done: boolean; label: string; help: string }) => (
          <li className="rounded-lg border border-line p-3"><p className="font-semibold">{done ? "✓ " : ""}{label}</p><p className="text-sm text-ink-soft">{help}</p>
            {!done && <form action={employmentItem} className="mt-2"><input type="hidden" name="item" value={item} /><button className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold">Mark done</button></form>}</li>
        );
        return (
          <div className="space-y-3">
            <ul className="space-y-2">
              <Item item="w4" done={t?.w4_status !== "not_started"} label="Federal Form W-4" help="Completed with Built2Bid's payroll provider (or on paper with the owner until payroll is connected). Your withholding is never calculated by Built2Bid." />
              <Item item="state_w4" done={t?.state_w4_status !== "not_started"} label="Minnesota Form W-4MN" help="Required for Minnesota withholding." />
              <Item item="i9_section1" done={t?.i9_section1_status !== "not_started"} label="Form I-9, Section 1" help="Complete it by your first day; the owner then examines your documents for Section 2." />
              <Item item="wage_notice" done={!!t?.wage_notice_ack_at} label="Minnesota employee notice" help={`Your pay: ${me.comp_types.map((c) => COMP[c]).join(", ") || "as agreed"}${me.pay_rate_cents != null ? `, ${money(me.pay_rate_cents)}${me.pay_unit ? ` per ${me.pay_unit}` : ""}` : ""}; pay frequency: ${me.pay_frequency ?? "to be set"}. Employer: Built2Bid LLC, 5450 Nicklaus Drive NW, Rochester, MN 55901. Acknowledge that you received this notice and the full notice text in Agreements.`} />
            </ul>
          </div>
        );
      }
      return <p className="text-ink-soft">This step opens once your classification is set.</p>;
    }
    case "payout":
      if (me.classification === "employee_w2") return (
        <div className="space-y-3 text-sm"><p>You&apos;re paid through payroll. Direct deposit is set up with the payroll provider, or you can choose a paper check. Payroll Integration Required: until it&apos;s connected, the owner pays wages through an established payroll service, never from this app.</p>
          <form action={paymentMethod} className="flex flex-wrap gap-2"><button name="method" value="payroll" className={primary}>Direct deposit via payroll</button><button name="method" value="check" className="min-h-11 rounded-lg border border-line px-4 font-semibold">Paper check</button></form></div>
      );
      if (!contractor) return <p className="text-ink-soft">This step opens once your classification is set.</p>;
      return (
        <div className="space-y-3 text-sm">
          {me.destinations.length > 0 ? <p>✓ {me.destinations[0].institution_name ?? "Bank"} ••{me.destinations[0].last4 ?? "????"} ({me.destinations[0].status})</p> : <p>Connect the bank account where you want your payouts. You&apos;ll enter it on our payment provider&apos;s secure page; Built2Bid never sees your full account number or bank password.</p>}
          <div className="flex flex-wrap gap-2">
            <Link href="/staff/payouts#connect" className={primary}>{me.destinations.length ? "Manage bank account" : "Connect bank account"}</Link>
            {me.destinations.length > 0 && <Link href="/staff/onboarding?step=security" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 font-semibold">Continue</Link>}
          </div>
          <form action={paymentMethod}><input type="hidden" name="method" value="check" /><button className="text-sm text-muted underline">I can&apos;t use direct deposit (paper check)</button></form>
        </div>
      );
    case "security": return (
      <div className="space-y-3 text-sm">
        <p>Built2Bid protects pay and tax information with two-step sign-in (an authenticator app code after your email code).</p>
        {me.security_confirmed_at ? <p className="font-semibold text-success">✓ Two-step sign-in confirmed</p> : (<>
          <ol className="list-decimal space-y-1 pl-5 text-ink-soft"><li>Open <a className="underline" href="/settings/account#two-step">Account settings → Two-step sign-in</a> and add an authenticator app.</li><li>Sign out and back in with your authenticator code.</li><li>Come back here and confirm.</li></ol>
          <form action={confirmSecurity}><button className={primary}>I&apos;ve turned it on, confirm</button></form>
        </>)}
        {me.security_confirmed_at && <Link className={primary} href="/staff/onboarding?step=confirm">Continue</Link>}
      </div>
    );
    default: {
      const open = me.onboarding.steps.filter((x) => x.key !== "confirm" && (x.state === "todo" || x.state === "blocked"));
      return me.onboarding.complete ? <p className="font-semibold text-success">✓ Onboarding complete. <Link className="underline" href="/staff">Go to my profile</Link></p> : (
        <div className="space-y-3 text-sm">
          {open.length ? <><p>Still to do:</p><ul className="list-disc pl-5">{open.map((x) => <li key={x.key}><Link className="underline" href={`/staff/onboarding?step=${x.key}`}>{x.label}</Link>{x.state === "blocked" ? " (waiting on the owner)" : ""}</li>)}</ul></>
            : <><p>Everything is in. Confirm that the information you gave is accurate.</p><form action={finish}><button className={primary}>Finish onboarding</button></form></>}
        </div>
      );
    }
  }
}
