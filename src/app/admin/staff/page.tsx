import Link from "next/link";
import { PageHead, Panel, Table, Chip, Empty, Mini, type Tone } from "@/components/admin/cc";
import { requireStaffCap } from "@/lib/staff/server";
import { CLASSIFICATION, ROLE, STAFF_STATUS } from "@/lib/payouts/labels";
import { STAFF_ERR } from "@/lib/staff/flash";
import { StaffForm, type StaffRow } from "@/components/staff/staff-form";
import { createStaff } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team & Staff" };

const STATUS_TONE: Record<string, Tone> = { invited: "blue", onboarding: "amber", active: "green", suspended: "red", terminated: "muted" };

/**
 * Administration → Team & Staff: Built2Bid's own people (sales reps, finance, operations, accountants). Separate
 * from any customer's Enterprise company administration; customer admins can never reach these records.
 */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ new?: string; err?: string; q?: string; status?: string }> }) {
  const { user, db } = await requireStaffCap("staff.view");
  const sp = await searchParams;
  const { data, error } = await db.rpc("admin_staff_list", { p_caller: user.id });
  const all = ((error ? [] : data) ?? []) as StaffRow[];
  const q = (sp.q ?? "").toLowerCase();
  const list = all.filter((s) => (!sp.status || s.status === sp.status) && (!q || `${s.display_name} ${s.email} ${s.job_title ?? ""}`.toLowerCase().includes(q)));
  const count = (st: string) => all.filter((s) => s.status === st).length;
  const pending = all.filter((s) => s.classification === "pending_review" && s.status !== "terminated").length;
  return (
    <div className="space-y-6">
      <PageHead kicker="Administration" title="Team & Staff" intro="Built2Bid's internal people: invite, onboard, classify, suspend. Customer company admins never see this."
        right={<Link href="/admin/staff?new=1#new" className="cc-mono rounded-md border border-[var(--cc-green)] px-3 py-2 text-xs text-[var(--cc-green)] hover:bg-[rgb(61_255_168/0.1)]">+ Add staff member</Link>} />
      {error && <p role="alert" className="cc-mono rounded-md border border-[var(--cc-amber)]/50 px-3 py-2 text-xs text-[var(--cc-amber)]">Team & Staff needs migration 20270207001000_staff_payouts.sql.</p>}
      {sp.err && <p role="alert" className="cc-mono rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-xs text-[var(--cc-red)]">{STAFF_ERR[sp.err] ?? STAFF_ERR.invalid}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Mini label="Active" value={count("active")} tone="green" />
        <Mini label="Onboarding" value={count("onboarding") + count("invited")} tone="amber" />
        <Mini label="Suspended" value={count("suspended")} tone="red" />
        <Mini label="Classification to review" value={pending} tone={pending ? "amber" : "muted"} />
        <Mini label="Total" value={all.length} />
      </div>
      {sp.new && (
        <Panel id="new" title="Add a staff member" kicker="Invite">
          <StaffForm people={all} action={createStaff} submit="Add and create onboarding link" />
        </Panel>
      )}
      <Panel title="Staff directory" action={
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name or email" className="field field-sm w-48" />
          <select name="status" defaultValue={sp.status ?? ""} className="field field-sm"><option value="">All statuses</option>{Object.entries(STAFF_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]">Filter</button>
        </form>}>
        {list.length === 0 ? <Empty>No staff yet. Sales Hub reps appear here automatically as &quot;Pending classification review&quot;.</Empty> : (
          <Table head={["Name", "Role", "Classification", "Onboarding", "Payout bank", "Status"]} minWidth={820}>
            {list.map((s) => {
              const steps = s.onboarding?.steps ?? [];
              const done = steps.filter((x) => x.state === "done" || x.state === "payroll").length;
              const bank = s.destinations[0];
              return (
                <tr key={s.id} className="border-t border-[var(--cc-line)]">
                  <td className="py-2 pr-3"><Link href={`/admin/staff/${s.id}`} className="font-semibold text-white underline-offset-2 hover:underline">{s.preferred_name ?? s.display_name}</Link><div className="text-xs text-ink-soft">{s.email}</div></td>
                  <td className="py-2 pr-3 text-xs text-ink-soft">{s.job_title ?? "—"}<div>{s.roles.map((r) => ROLE[r] ?? r).join(", ")}</div></td>
                  <td className="py-2 pr-3 text-xs">{s.classification === "pending_review" ? <Chip tone="amber">Needs review</Chip> : <span className="text-white">{CLASSIFICATION[s.classification]}</span>}</td>
                  <td className="cc-mono py-2 pr-3 text-xs text-white">{s.onboarding?.complete ? "Complete" : `${done}/${steps.length || 7}`}</td>
                  <td className="cc-mono py-2 pr-3 text-xs text-ink-soft">{s.classification === "employee_w2" ? "Payroll" : bank ? `${bank.institution_name ?? "Bank"} ••${bank.last4 ?? "?"} · ${bank.status}${bank.mode === "test" ? " (test)" : ""}` : "—"}</td>
                  <td className="py-2"><Chip tone={STATUS_TONE[s.status] ?? "muted"}>{STAFF_STATUS[s.status] ?? s.status}</Chip></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
      <p className="text-xs text-ink-soft">Signed in as owner {user.email}. Related: <Link className="underline" href="/admin/payouts">Payments &amp; Payouts</Link> · <Link className="underline" href="/admin/banking">Banking &amp; Cash Flow</Link> · <Link className="underline" href="/sales/admin">Sales Hub</Link></p>
    </div>
  );
}
