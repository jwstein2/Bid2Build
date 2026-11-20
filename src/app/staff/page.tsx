import Link from "next/link";
import { loadStaffSelf } from "@/lib/staff/server";
import { CLASSIFICATION, COMP, ROLE, STAFF_STATUS } from "@/lib/payouts/labels";
import { cn } from "@/lib/cn";

export const metadata = { title: "My profile" };

const primary = "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-5 font-semibold text-white active:scale-[0.98]";
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-3 border-b border-line py-2 text-sm last:border-0"><span className="text-ink-soft">{k}</span><span className="text-right font-medium">{v}</span></div>;

/** Staff home: onboarding progress, own profile (read-only summary), and links to payouts and finance views. */
export default async function StaffHome({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { me, user } = await loadStaffSelf("/staff");
  if (!me) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">No staff profile</h1>
      <p className="text-ink-soft">{user.email} isn&apos;t in the Built2Bid staff directory. If you were sent an onboarding link, open it from the same email address. Otherwise contact the owner.</p>
    </div>
  );
  if (me.status === "suspended" || me.status === "terminated") return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Account {STAFF_STATUS[me.status].toLowerCase()}</h1>
      <p className="text-ink-soft">Your staff access is {STAFF_STATUS[me.status].toLowerCase()}. Contact the owner if you have questions about pay already earned; earned amounts stay on record.</p>
    </div>
  );
  const steps = me.onboarding?.steps ?? [];
  const done = steps.filter((s) => s.state === "done" || s.state === "payroll").length;
  const contractor = me.classification === "contractor_1099" || me.classification === "vendor";
  const finance = me.caps.some((c) => c === "payouts.view" || c === "banking.view" || c === "reports.export");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Hi {me.preferred_name ?? me.legal_first_name ?? me.display_name.split(" ")[0]}</h1>
        <p className="mt-1 text-ink-soft">{me.job_title ?? "Staff"} · {STAFF_STATUS[me.status]}</p>
      </div>
      {sp.ok === "onboarded" && <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success">You&apos;re all set. Your onboarding is complete.</p>}
      {sp.err === "not_staff" && <p role="alert" className="rounded-lg bg-warn-tint px-4 py-3 text-sm">That needs an active staff profile.</p>}
      {me.onboarding && !me.onboarding.complete && (
        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Finish setting up ({done} of {steps.length})</h2>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" aria-hidden><div className="h-full bg-success" style={{ width: `${Math.round((done / Math.max(steps.length, 1)) * 100)}%` }} /></div>
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {steps.map((s) => <li key={s.key} className={cn(s.state === "done" || s.state === "payroll" ? "text-success" : "text-ink-soft")}>{s.state === "done" || s.state === "payroll" ? "✓" : "○"} {s.label}</li>)}
          </ul>
          <Link href="/staff/onboarding" className={cn(primary, "mt-4")}>Continue onboarding</Link>
        </section>
      )}
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">My profile</h2>
        <div className="mt-2">
          <Row k="Legal name" v={[me.legal_first_name, me.legal_last_name].filter(Boolean).join(" ") || "—"} />
          <Row k="Email" v={me.email} />
          <Row k="Phone" v={me.phone ?? "—"} />
          <Row k="Address" v={me.address_line1 ? `${me.address_line1}${me.address_line2 ? `, ${me.address_line2}` : ""}, ${me.city ?? ""} ${me.state ?? ""} ${me.postal_code ?? ""}` : "—"} />
          <Row k="Emergency contact" v={me.emergency_name ? `${me.emergency_name}${me.emergency_relation ? ` (${me.emergency_relation})` : ""} ${me.emergency_phone ?? ""}` : "—"} />
          <Row k="Classification" v={CLASSIFICATION[me.classification] ?? me.classification} />
          <Row k="Compensation" v={me.comp_types.map((c) => COMP[c] ?? c).join(", ") || "—"} />
          <Row k="Roles" v={me.roles.map((r) => ROLE[r] ?? r).join(", ") || "—"} />
          <Row k="Tax form" v={contractor ? (me.tax?.w9_status === "verified" ? `W-9 verified (••${me.tax.tin_last4})` : me.tax?.w9_status === "submitted" ? `W-9 submitted (••${me.tax.tin_last4})` : "W-9 needed") : me.classification === "employee_w2" ? "W-4 / I-9 with payroll" : "—"} />
        </div>
        <p className="mt-3 text-xs text-ink-soft">To change your name, address or emergency contact, use <Link className="underline" href="/staff/onboarding?step=personal">Personal details</Link>. The owner changes job title, classification and pay.</p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/staff/payouts" className="rounded-2xl border border-line bg-white p-5 shadow-sm hover:border-ink"><p className="font-bold">Payouts</p><p className="mt-1 text-sm text-ink-soft">{contractor ? "Bank account, payout history, fees and statements." : "How you're paid."}</p></Link>
        {me.sales_rep && <Link href="/sales/commissions" className="rounded-2xl border border-line bg-white p-5 shadow-sm hover:border-ink"><p className="font-bold">Commission statements</p><p className="mt-1 text-sm text-ink-soft">Your Sales Hub earnings and approvals.</p></Link>}
        {finance && <Link href="/staff/finance" className="rounded-2xl border border-line bg-white p-5 shadow-sm hover:border-ink"><p className="font-bold">Finance (read-only)</p><p className="mt-1 text-sm text-ink-soft">Payout ledger, banking and exports you&apos;ve been granted.</p></Link>}
      </div>
    </div>
  );
}
